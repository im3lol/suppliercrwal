import os
import asyncio
import json
from contextlib import asynccontextmanager
from datetime import datetime
from typing import List, Optional

import pandas as pd
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from scraper import crew_scrape, crew_scrape_bulk
from database import init_db, get_session
from store import (
    EXCEL_FILE,
    DATA_DIR,
    save_offers,
    get_all_records,
    count_rows,
    count_scans,
    get_scan_keys_paginated,
    get_records_for_scans,
    get_all_scan_keys,
    delete_scans,
    delete_all_scans,
    import_from_dataframe,
    migrate_excel_if_needed,
    export_to_excel_path,
    _parse_timestamp,
)


class ScrapeInput(BaseModel):
    asins: List[str]


class ScanRef(BaseModel):
    asin: str
    timestamp: str


class DeleteScansInput(BaseModel):
    select_all: bool = False
    scans: List[ScanRef] = []


def to_dict(item):
    if isinstance(item, dict):
        return item
    if hasattr(item, "model_dump"):
        return item.model_dump()
    if hasattr(item, "dict"):
        return item.dict()
    return dict(item)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    with get_session() as session:
        imported = migrate_excel_if_needed(session)
        if imported:
            print(f"[DB] Migrated {imported} rows from Excel into PostgreSQL")
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    with get_session() as session:
        rows = count_rows(session)
    return {"status": "ok", "rows": rows}


@app.get("/stats")
def stats():
    with get_session() as session:
        return {
            "total_rows": count_rows(session),
            "total_scans": count_scans(session),
        }


@app.get("/scans")
def list_scans(limit: int = 500, offset: int = 0):
    limit = min(max(limit, 1), 2000)
    offset = max(offset, 0)
    with get_session() as session:
        total_scans = count_scans(session)
        total_rows = count_rows(session)
        keys = get_scan_keys_paginated(session, limit, offset)
        records = get_records_for_scans(session, keys)
    return {
        "total_scans": total_scans,
        "total_rows": total_rows,
        "limit": limit,
        "offset": offset,
        "records": records,
    }


@app.get("/results")
def get_results():
    with get_session() as session:
        return get_all_records(session)


@app.delete("/scans")
def remove_scans(body: DeleteScansInput):
    with get_session() as session:
        if body.select_all:
            deleted = delete_all_scans(session)
            return {"deleted_rows": deleted, "message": "All records deleted"}

        if not body.scans:
            raise HTTPException(status_code=400, detail="No scans selected")

        keys = [(s.asin.strip(), _parse_timestamp(s.timestamp)) for s in body.scans if s.asin.strip()]
        deleted = delete_scans(session, keys)
        return {"deleted_rows": deleted, "deleted_scans": len(keys)}


@app.post("/scrape/stream")
async def stream_scrape(data: ScrapeInput):
    asins = [a.strip() for a in data.asins if a.strip()]
    if not asins:
        raise HTTPException(status_code=400, detail="No ASINs provided")

    results_queue: asyncio.Queue = asyncio.Queue()
    state = {"pending": len(asins)}

    async def worker(asin: str):
        try:
            results = await crew_scrape(asin)
            dicts = [to_dict(item) for item in results]
            with get_session() as session:
                save_offers(session, results)
            await results_queue.put({
                "type": "results",
                "asin": asin,
                "data": dicts,
            })
        except Exception as e:
            print(f"[Stream] Error for {asin}: {e}")
            await results_queue.put({
                "type": "error",
                "asin": asin,
                "error": str(e),
            })
        finally:
            state["pending"] -= 1
            await results_queue.put({"type": "tick"})
            await asyncio.sleep(5)

    semaphore = asyncio.Semaphore(1)

    async def guarded_worker(asin: str):
        async with semaphore:
            await worker(asin)

    tasks = [asyncio.create_task(guarded_worker(a)) for a in asins]

    async def event_generator():
        while state["pending"] > 0:
            item = await results_queue.get()
            if item["type"] in ("results", "error"):
                yield f"data: {json.dumps(item)}\n\n"
        yield f"data: {json.dumps({'type': 'done', 'total': len(asins)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/scrape")
async def run_scrape(data: ScrapeInput):
    asins = [a.strip() for a in data.asins if a.strip()]
    if not asins:
        raise HTTPException(status_code=400, detail="No ASINs provided")

    flat_results = await crew_scrape_bulk(asins)
    if not flat_results:
        raise HTTPException(status_code=404, detail="No products found")

    with get_session() as session:
        save_offers(session, flat_results)
    return [to_dict(item) for item in flat_results]


@app.post("/import-excel")
async def import_excel(file: UploadFile = File(...)):
    temp_path = os.path.join(DATA_DIR, "temp_import.xlsx")
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(temp_path, "wb") as f:
            f.write(await file.read())
        df_imported = pd.read_excel(temp_path).fillna("")
        required = ["ASIN", "Domain", "Name", "Price"]
        if not all(col in df_imported.columns for col in required):
            raise HTTPException(status_code=400, detail="Invalid format")
        with get_session() as session:
            count = import_from_dataframe(session, df_imported)
        return {"count": count, "message": "Imported successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


@app.get("/download-excel")
def download_excel():
    export_path = os.path.join(DATA_DIR, "export_results.xlsx")
    try:
        with get_session() as session:
            export_to_excel_path(session, export_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="No data available")

    def iter_file():
        with open(export_path, "rb") as f:
            yield from f

    return StreamingResponse(
        iter_file(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="suppliercrawl_results.xlsx"'},
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
