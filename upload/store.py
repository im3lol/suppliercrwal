import os
from datetime import datetime
from typing import List, Optional, Tuple

import pandas as pd
from sqlalchemy import delete, func, select, tuple_
from sqlalchemy.orm import Session

from models import OfferRecord

_default_data = os.path.join(os.path.dirname(__file__), "..", "data")
DATA_DIR = os.path.abspath(os.environ.get("DATA_DIR", _default_data))
EXCEL_FILE = os.path.join(DATA_DIR, "results.xlsx")


def _parse_timestamp(value) -> datetime:
    if isinstance(value, datetime):
        return value
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return datetime.utcnow()
    text = str(value).strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(text[:19], fmt)
        except ValueError:
            continue
    return datetime.utcnow()


def _str_val(value, default: str = "") -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return default
    return str(value)


def record_from_dict(d: dict) -> OfferRecord:
    return OfferRecord(
        asin=_str_val(d.get("ASIN") or d.get("asin")),
        timestamp=_parse_timestamp(d.get("Timestamp") or d.get("timestamp")),
        domain=_str_val(d.get("Domain") or d.get("domain")),
        name=_str_val(d.get("Name") or d.get("name")),
        image=_str_val(d.get("Image") or d.get("image")),
        price=_str_val(d.get("Price") or d.get("price"), "N/A"),
        currency=_str_val(d.get("Currency") or d.get("currency")),
        price_display=_str_val(
            d.get("Price Display") or d.get("price_display"), "N/A"
        ),
        is_main=bool(d.get("Is Main", d.get("is_main", True))),
    )


def save_offers(session: Session, results: list, timestamp: Optional[datetime] = None) -> int:
    ts = timestamp or datetime.utcnow()
    rows: List[OfferRecord] = []
    for item in results:
        if isinstance(item, OfferRecord):
            item.timestamp = ts
            rows.append(item)
            continue
        d = item if isinstance(item, dict) else (
            item.model_dump() if hasattr(item, "model_dump") else item.dict()
        )
        d = dict(d)
        d["Timestamp"] = ts
        rows.append(
            OfferRecord(
                asin=_str_val(d.get("ASIN") or d.get("asin", "")),
                timestamp=ts,
                domain=_str_val(d.get("domain") or d.get("Domain", "")),
                name=_str_val(d.get("name") or d.get("Name", "")),
                image=_str_val(d.get("image") or d.get("Image", "")),
                price=_str_val(d.get("price") or d.get("Price"), "N/A"),
                currency=_str_val(d.get("currency") or d.get("Currency", "")),
                price_display=_str_val(d.get("price_display") or d.get("Price Display"), "N/A"),
                is_main=bool(d.get("is_main", d.get("Is Main", True))),
            )
        )
    session.add_all(rows)
    session.flush()
    return len(rows)


def get_all_records(session: Session) -> List[dict]:
    rows = session.scalars(
        select(OfferRecord).order_by(OfferRecord.timestamp.desc(), OfferRecord.id.desc())
    ).all()
    return [r.to_api_dict() for r in rows]


def count_rows(session: Session) -> int:
    return session.scalar(select(func.count()).select_from(OfferRecord)) or 0


def _scan_groups_subquery():
    return (
        select(OfferRecord.asin, OfferRecord.timestamp)
        .group_by(OfferRecord.asin, OfferRecord.timestamp)
        .subquery()
    )


def count_scans(session: Session) -> int:
    sub = _scan_groups_subquery()
    return session.scalar(select(func.count()).select_from(sub)) or 0


def get_scan_keys_paginated(
    session: Session, limit: int = 500, offset: int = 0
) -> List[Tuple[str, datetime]]:
    q = (
        select(OfferRecord.asin, OfferRecord.timestamp)
        .group_by(OfferRecord.asin, OfferRecord.timestamp)
        .order_by(func.max(OfferRecord.timestamp).desc())
        .limit(limit)
        .offset(offset)
    )
    return list(session.execute(q).all())


def get_records_for_scans(
    session: Session, keys: List[Tuple[str, datetime]]
) -> List[dict]:
    if not keys:
        return []
    rows = session.scalars(
        select(OfferRecord)
        .where(tuple_(OfferRecord.asin, OfferRecord.timestamp).in_(keys))
        .order_by(OfferRecord.timestamp.desc(), OfferRecord.id.desc())
    ).all()
    return [r.to_api_dict() for r in rows]


def get_all_scan_keys(session: Session) -> List[Tuple[str, datetime]]:
    rows = session.execute(
        select(OfferRecord.asin, OfferRecord.timestamp).distinct()
    ).all()
    return list(rows)


def delete_scans(
    session: Session,
    keys: List[Tuple[str, datetime]],
) -> int:
    if not keys:
        return 0
    result = session.execute(
        delete(OfferRecord).where(
            tuple_(OfferRecord.asin, OfferRecord.timestamp).in_(keys)
        )
    )
    return result.rowcount or 0


def delete_all_scans(session: Session) -> int:
    result = session.execute(delete(OfferRecord))
    return result.rowcount or 0


def import_from_dataframe(session: Session, df: pd.DataFrame) -> int:
    count = 0
    for _, row in df.iterrows():
        session.add(record_from_dict(row.to_dict()))
        count += 1
    session.flush()
    return count


def migrate_excel_if_needed(session: Session) -> int:
    if not os.path.exists(EXCEL_FILE):
        return 0
    if count_rows(session) > 0:
        return 0
    df = pd.read_excel(EXCEL_FILE).fillna("")
    return import_from_dataframe(session, df)


def export_to_excel_path(session: Session, path: str) -> None:
    records = get_all_records(session)
    if not records:
        raise FileNotFoundError("No data")
    cols = [
        "ASIN", "Timestamp", "Domain", "Name", "Image",
        "Price", "Currency", "Price Display", "Is Main",
    ]
    df = pd.DataFrame(records)
    df = df[[c for c in cols if c in df.columns]]
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    df.to_excel(path, index=False)
