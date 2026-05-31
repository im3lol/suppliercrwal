'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Zap, Download, Trash2, RefreshCw,
  Globe, Activity, Database, Server, ChevronRight,
  Loader2, CheckCircle2, XCircle,
  LayoutDashboard, History, Settings, Shield,
  Package, MapPin, FileText, StopCircle,
  Archive, FileSpreadsheet, Filter, Search,
  Calendar, TrendingUp, ArrowUpDown, ArrowUp, ArrowDown
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TYPES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface PriceInfo {
  price: string
  currency: string
  priceDisplay: string
  domain: string
  updatedAt: string
}

interface Product {
  id: string
  asin: string
  name: string
  image: string
  lastScan: string
  prices: Record<string, PriceInfo>
}

type ViewMode = 'live' | 'history'
type SortField = 'asin' | 'name' | 'lastScan' | 'COM' | 'EG' | 'DE' | 'SA' | 'AE'
type SortDir = 'asc' | 'desc'

interface LogEntry {
  time: string
  asin: string
  status: 'pending' | 'running' | 'done' | 'error'
  message: string
  pricesFound: number
}

const REGIONS = [
  { key: 'EG', label: 'Egypt', flag: '🇪🇬', short: 'EG' },
  { key: 'COM', label: 'USA', flag: '🇺🇸', short: 'COM' },
  { key: 'DE', label: 'Germany', flag: '🇩🇪', short: 'DE' },
  { key: 'SA', label: 'Saudi', flag: '🇸🇦', short: 'SA' },
  { key: 'AE', label: 'UAE', flag: '🇦🇪', short: 'AE' },
]

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN COMPONENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export default function Home() {
  const [viewMode, setViewMode] = useState<ViewMode>('live')
  const [products, setProducts] = useState<Product[]>([])
  const [asinInput, setAsinInput] = useState('')
  const [isCrawling, setIsCrawling] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(false)
  const [currentTime, setCurrentTime] = useState('')
  const [totalScans, setTotalScans] = useState(0)
  const [crawlLog, setCrawlLog] = useState<LogEntry[]>([])
  const [crawlCurrent, setCrawlCurrent] = useState(0)
  const [crawlTotal, setCrawlTotal] = useState(0)
  const abortRef = useRef(false)
  const logEndRef = useRef<HTMLDivElement>(null)

  // History-specific state
  const [historySearch, setHistorySearch] = useState('')
  const [sortField, setSortField] = useState<SortField>('lastScan')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [historySelectedIds, setHistorySelectedIds] = useState<Set<string>>(new Set())

  const { toast } = useToast()

  // Update clock
  useEffect(() => {
    const update = () => {
      setCurrentTime(
        new Date().toLocaleTimeString('en-US', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          timeZone: 'UTC',
        }) + ' UTC'
      )
    }
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [])

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [crawlLog])

  // Fetch products
  const fetchProducts = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch('/api/products')
      const data = await res.json()
      if (data.success) {
        setProducts(data.data)
        setTotalScans(data.total)
      }
    } catch (e) {
      console.error('Failed to fetch products:', e)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchProducts()
  }, [fetchProducts])

  // ── Timestamp helper ──
  const ts = () =>
    new Date().toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })

  // ── Bulk Crawl Handler (FOR LOOP — sequential per ASIN) ──
  const handleBulkCrawl = async () => {
    const asins = asinInput
      .split(/[\n,;\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter((s) => /^[A-Z0-9]{10}$/.test(s))

    const uniqueAsins = [...new Set(asins)]

    if (uniqueAsins.length === 0) {
      toast({
        title: 'No valid ASINs',
        description: 'Enter ASINs (10 alphanumeric chars), one per line or comma-separated',
        variant: 'destructive',
      })
      return
    }

    setIsCrawling(true)
    abortRef.current = false
    setCrawlTotal(uniqueAsins.length)
    setCrawlCurrent(0)
    setCrawlLog([])

    const initLogs: LogEntry[] = uniqueAsins.map((asin) => ({
      time: ts(),
      asin,
      status: 'pending',
      message: 'Queued',
      pricesFound: 0,
    }))
    setCrawlLog(initLogs)

    let totalPricesFound = 0

    for (let i = 0; i < uniqueAsins.length; i++) {
      if (abortRef.current) {
        setCrawlLog((prev) =>
          prev.map((entry, idx) =>
            idx >= i && entry.status === 'pending'
              ? { ...entry, status: 'error', message: 'Aborted', time: ts() }
              : entry
          )
        )
        break
      }

      const asin = uniqueAsins[i]
      setCrawlCurrent(i + 1)

      setCrawlLog((prev) =>
        prev.map((entry, idx) =>
          idx === i ? { ...entry, status: 'running', message: 'Scanning 5 regions...', time: ts() } : entry
        )
      )

      try {
        const res = await fetch('/api/crawl', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ asins: [asin] }),
        })

        const data = await res.json()

        if (data.success && data.data && data.data.length > 0) {
          const result = data.data[0]
          const pricesFound = result.results
            ? result.results.filter((r: { price: string }) => r.price !== 'N/A').length
            : 0
          totalPricesFound += pricesFound

          setCrawlLog((prev) =>
            prev.map((entry, idx) =>
              idx === i
                ? { ...entry, status: 'done', message: `${pricesFound}/5 prices found`, pricesFound, time: ts() }
                : entry
            )
          )
        } else {
          setCrawlLog((prev) =>
            prev.map((entry, idx) =>
              idx === i ? { ...entry, status: 'error', message: data.error || 'Failed', time: ts() } : entry
            )
          )
        }
      } catch {
        setCrawlLog((prev) =>
          prev.map((entry, idx) =>
            idx === i ? { ...entry, status: 'error', message: 'Network error', time: ts() } : entry
          )
        )
      }

      await fetchProducts()

      if (i < uniqueAsins.length - 1 && !abortRef.current) {
        await new Promise((r) => setTimeout(r, 1500))
      }
    }

    setIsCrawling(false)
    setAsinInput('')

    toast({
      title: 'Bulk Scan Complete',
      description: `${totalPricesFound} total prices found across ${uniqueAsins.length} product(s)`,
    })
  }

  const handleStopCrawl = () => {
    abortRef.current = true
    toast({ title: 'Stopping...', description: 'Will stop after current ASIN finishes' })
  }

  // ── Delete Handler ──
  const handleDelete = async (ids: Set<string>) => {
    if (ids.size === 0) {
      toast({ title: 'No items selected', variant: 'destructive' })
      return
    }

    try {
      await fetch('/api/products', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(ids) }),
      })
      if (viewMode === 'live') setSelectedIds(new Set())
      else setHistorySelectedIds(new Set())
      fetchProducts()
      toast({ title: 'Deleted', description: `${ids.size} product(s) deleted` })
    } catch {
      toast({ title: 'Delete failed', variant: 'destructive' })
    }
  }

  // ── Export Handlers ──
  const handleExportExcel = () => {
    window.open('/api/export?format=xlsx', '_blank')
  }

  const handleExportCSV = () => {
    window.open('/api/export?format=csv', '_blank')
  }

  // ── Select helpers ──
  const toggleSelectAll = (ids: Set<string>, setIds: (v: Set<string>) => void, items: Product[]) => {
    if (ids.size === items.length) setIds(new Set())
    else setIds(new Set(items.map((p) => p.id)))
  }

  const toggleSelect = (id: string, ids: Set<string>, setIds: (v: Set<string>) => void) => {
    const next = new Set(ids)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setIds(next)
  }

  // ── Sorting & Filtering for History ──
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const filteredProducts = products.filter((p) => {
    if (!historySearch) return true
    const q = historySearch.toLowerCase()
    return (
      p.asin.toLowerCase().includes(q) ||
      p.name.toLowerCase().includes(q) ||
      Object.values(p.prices).some((pr) => pr.priceDisplay.toLowerCase().includes(q))
    )
  })

  const sortedProducts = [...filteredProducts].sort((a, b) => {
    let cmp = 0
    if (sortField === 'asin') cmp = a.asin.localeCompare(b.asin)
    else if (sortField === 'name') cmp = a.name.localeCompare(b.name)
    else if (sortField === 'lastScan') cmp = new Date(a.lastScan).getTime() - new Date(b.lastScan).getTime()
    else {
      const regionKey = sortField
      const pa = a.prices[regionKey]
      const pb = b.prices[regionKey]
      const na = pa && pa.price !== 'N/A' ? parseFloat(pa.price) : -1
      const nb = pb && pb.price !== 'N/A' ? parseFloat(pb.price) : -1
      cmp = na - nb
    }
    return sortDir === 'asc' ? cmp : -cmp
  })

  const onlineRegions = 5
  const priceRows = products.reduce(
    (acc, p) => acc + Object.values(p.prices).filter((pr) => pr.price !== 'N/A').length,
    0
  )
  const productsWithPrices = products.filter((p) =>
    Object.values(p.prices).some((pr) => pr.price !== 'N/A')
  ).length

  const doneCount = crawlLog.filter((l) => l.status === 'done').length
  const errorCount = crawlLog.filter((l) => l.status === 'error').length
  const runningCount = crawlLog.filter((l) => l.status === 'running').length

  const currentSelectedIds = viewMode === 'live' ? selectedIds : historySelectedIds
  const currentSetSelected = viewMode === 'live' ? setSelectedIds : setHistorySelectedIds

  // Sort icon helper
  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-0.5 text-gray-600" />
    return sortDir === 'asc' ? (
      <ArrowUp className="w-3 h-3 ml-0.5 text-orange-400" />
    ) : (
      <ArrowDown className="w-3 h-3 ml-0.5 text-orange-400" />
    )
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // RENDER
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  return (
    <div className="min-h-screen flex bg-[#0a0a0a] text-gray-100 font-mono">
      {/* ── SIDEBAR ── */}
      <aside className="w-56 bg-[#0f0f0f] border-r border-[#1a1a1a] flex flex-col shrink-0">
        <div className="p-4 border-b border-[#1a1a1a]">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-orange-500 flex items-center justify-center text-black font-bold text-sm">
              SC
            </div>
            <div>
              <div className="text-orange-400 font-bold text-sm tracking-wider">SUPPLIER</div>
              <div className="text-orange-400 font-bold text-sm tracking-wider">CRAWL</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          <div className="text-[10px] text-gray-600 uppercase tracking-widest mb-2 px-2">Navigation</div>
          {[
            { icon: LayoutDashboard, label: 'Market Overview', key: 'overview' },
            { icon: Activity, label: 'Live Crawls', key: 'live' },
            { icon: History, label: 'Historical Data', key: 'history' },
          ].map((item) => (
            <button
              key={item.key}
              onClick={() => {
                if (item.key === 'live' || item.key === 'history') {
                  setViewMode(item.key as ViewMode)
                }
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded text-xs transition-colors ${
                (item.key === 'live' && viewMode === 'live') ||
                (item.key === 'history' && viewMode === 'history')
                  ? 'bg-orange-500/10 text-orange-400'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-[#1a1a1a]'
              }`}
            >
              <item.icon className="w-3.5 h-3.5" />
              {item.label}
              {(item.key === 'live' && viewMode === 'live') ||
              (item.key === 'history' && viewMode === 'history') ? (
                <ChevronRight className="w-3 h-3 ml-auto" />
              ) : null}
            </button>
          ))}

          <div className="text-[10px] text-gray-600 uppercase tracking-widest mt-4 mb-2 px-2">System</div>
          {[
            { icon: Settings, label: 'API Config' },
            { icon: Shield, label: 'Proxy Health' },
          ].map((item) => (
            <button
              key={item.label}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded text-xs text-gray-500 hover:text-gray-300 hover:bg-[#1a1a1a] transition-colors"
            >
              <item.icon className="w-3.5 h-3.5" />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="p-3 border-t border-[#1a1a1a] space-y-2">
          <div className="flex items-center gap-2 px-2">
            <div className="w-6 h-6 rounded bg-orange-500/20 flex items-center justify-center text-orange-400 text-[10px] font-bold">
              SC
            </div>
            <span className="text-[10px] text-gray-600">MULTI-REGION</span>
          </div>
          <button className="w-full flex items-center gap-2 px-3 py-2 rounded text-xs text-gray-600 hover:text-red-400 hover:bg-red-500/5 transition-colors">
            <XCircle className="w-3.5 h-3.5" />
            Terminate Session
          </button>
        </div>
      </aside>

      {/* ── MAIN CONTENT ── */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* ── HEADER ── */}
        <header className="bg-[#0f0f0f] border-b border-[#1a1a1a] px-4 py-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h1 className="text-sm font-bold text-gray-300 tracking-wider">GLOBAL TERMINAL</h1>
              <div className="flex items-center gap-3 text-[10px]">
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-green-400">EG-NORTH-1</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-green-400">EU-CENTRAL-1</span>
                </span>
              </div>
            </div>
            <div className="flex items-center gap-4 text-[10px] text-gray-500">
              <span>SYSTEM TIME</span>
              <span className="text-gray-300">{currentTime}</span>
            </div>
          </div>

          <div className="flex items-center gap-6 mt-2 text-[10px]">
            <span className="text-gray-500">
              TERMINAL STATUS: <span className="text-green-400">Online</span>
            </span>
            <span className="text-gray-500">
              TOTAL PRODUCTS: <span className="text-gray-200">{totalScans}</span>
            </span>
            <span className="text-gray-500">
              PRICE ROWS: <span className="text-gray-200">{priceRows}</span>
            </span>
            <span className="text-gray-500">
              REGIONS: <span className="text-orange-400">{onlineRegions} Active</span>
            </span>
            <div className="flex items-center gap-2 ml-auto">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setViewMode('live')}
                className={`h-6 text-[10px] px-3 rounded ${
                  viewMode === 'live'
                    ? 'bg-orange-500 text-black hover:bg-orange-600'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                LIVE MONITOR
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setViewMode('history')}
                className={`h-6 text-[10px] px-3 rounded ${
                  viewMode === 'history'
                    ? 'bg-orange-500 text-black hover:bg-orange-600'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                HISTORICAL DATA
              </Button>
            </div>
          </div>
        </header>

        {/* ── CONTENT ── */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* ═══════════════════════════════════════════════════════════
              LIVE MONITOR VIEW
          ═══════════════════════════════════════════════════════════ */}
          {viewMode === 'live' && (
            <>
              {/* ── CRAWL COMMAND ── */}
              <section className="bg-[#111111] rounded-lg border border-[#1a1a1a] overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a1a1a]">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-orange-400" />
                    <h2 className="text-xs font-bold tracking-wider">BULK CRAWL COMMAND</h2>
                    {isCrawling && crawlTotal > 0 && (
                      <span className="text-[10px] text-yellow-400 ml-2">[{crawlCurrent}/{crawlTotal}]</span>
                    )}
                  </div>
                  {isCrawling && (
                    <div className="flex items-center gap-3">
                      <div className="w-32 h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-orange-500 rounded-full transition-all duration-300"
                          style={{ width: `${crawlTotal > 0 ? (crawlCurrent / crawlTotal) * 100 : 0}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-yellow-400">
                        {crawlTotal > 0 ? Math.round((crawlCurrent / crawlTotal) * 100) : 0}%
                      </span>
                    </div>
                  )}
                </div>

                <div className="p-4 space-y-3">
                  <div className="relative">
                    <div className="absolute left-3 top-3 text-gray-600">
                      <FileText className="w-3.5 h-3.5" />
                    </div>
                    <textarea
                      value={asinInput}
                      onChange={(e) => setAsinInput(e.target.value)}
                      placeholder={`Enter ASINs — one per line, comma-separated, or space-separated\n\nExample:\nB08LKLQP2N\nB09V3KXJPB, B0BR4FQRT4\nB0D9LNJGSM B0CKBQRLDF`}
                      className="w-full bg-[#0a0a0a] border border-[#2a2a2a] text-gray-200 placeholder-gray-600 text-xs font-mono pl-9 pr-3 py-3 rounded-md focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/20 focus:outline-none resize-none h-28"
                      disabled={isCrawling}
                    />
                    <div className="absolute right-3 bottom-3 text-[10px] text-gray-600">
                      {asinInput
                        .split(/[\n,;\s]+/)
                        .filter((s) => /^[A-Z0-9]{10}$/i.test(s.trim())).length}{' '}
                      valid ASINs
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <Button
                      onClick={handleBulkCrawl}
                      disabled={isCrawling || !asinInput.trim()}
                      className="bg-orange-500 hover:bg-orange-600 text-black font-bold text-xs h-9 px-5 shrink-0"
                    >
                      {isCrawling ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                      ) : (
                        <Zap className="w-3.5 h-3.5 mr-1.5" />
                      )}
                      {isCrawling ? `SCANNING ${crawlCurrent}/${crawlTotal}...` : 'EXECUTE BULK SCAN'}
                    </Button>
                    {isCrawling && (
                      <Button
                        onClick={handleStopCrawl}
                        variant="outline"
                        className="bg-transparent border-red-500/50 text-red-400 hover:bg-red-500/10 text-xs h-9"
                      >
                        <StopCircle className="w-3.5 h-3.5 mr-1.5" />
                        STOP
                      </Button>
                    )}
                    <div className="text-[10px] text-gray-600 ml-2">
                      Sequential for-loop • 1.5s delay • 5 regions per ASIN
                    </div>
                  </div>
                </div>
              </section>

              {/* ── CRAWL LOG ── */}
              {crawlLog.length > 0 && (
                <section className="bg-[#111111] rounded-lg border border-[#1a1a1a] overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a1a1a]">
                    <div className="flex items-center gap-2">
                      <Activity className="w-4 h-4 text-orange-400" />
                      <h2 className="text-xs font-bold tracking-wider">CRAWL LOG</h2>
                      {isCrawling && runningCount > 0 && (
                        <span className="flex items-center gap-1 text-[10px] text-yellow-400">
                          <Loader2 className="w-3 h-3 animate-spin" /> Running
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[10px]">
                      <span className="text-green-400"><CheckCircle2 className="w-3 h-3 inline mr-0.5" />{doneCount}</span>
                      <span className="text-red-400"><XCircle className="w-3 h-3 inline mr-0.5" />{errorCount}</span>
                      <span className="text-gray-500">Total: {crawlLog.length}</span>
                    </div>
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="border-b border-[#1a1a1a] text-gray-500 text-[10px]">
                          <th className="text-left px-3 py-2 w-16">TIME</th>
                          <th className="text-left px-3 py-2 w-28">ASIN</th>
                          <th className="text-left px-3 py-2 w-20">STATUS</th>
                          <th className="text-left px-3 py-2">MESSAGE</th>
                        </tr>
                      </thead>
                      <tbody>
                        {crawlLog.map((entry, idx) => (
                          <tr
                            key={`${entry.asin}-${idx}`}
                            className={`border-b border-[#1a1a1a]/50 ${
                              entry.status === 'running' ? 'bg-yellow-500/5' :
                              entry.status === 'done' ? 'bg-green-500/5' :
                              entry.status === 'error' ? 'bg-red-500/5' : ''
                            }`}
                          >
                            <td className="px-3 py-1.5 text-gray-600">{entry.time}</td>
                            <td className="px-3 py-1.5">
                              <span className="bg-orange-500/10 text-orange-400 px-1.5 py-0.5 rounded font-mono text-[10px]">
                                {entry.asin}
                              </span>
                            </td>
                            <td className="px-3 py-1.5">
                              {entry.status === 'pending' && <span className="text-gray-600">⏳ Queued</span>}
                              {entry.status === 'running' && (
                                <span className="text-yellow-400 flex items-center gap-1">
                                  <Loader2 className="w-3 h-3 animate-spin" /> Scanning
                                </span>
                              )}
                              {entry.status === 'done' && (
                                <span className="text-green-400 flex items-center gap-1">
                                  <CheckCircle2 className="w-3 h-3" /> Done
                                </span>
                              )}
                              {entry.status === 'error' && (
                                <span className="text-red-400 flex items-center gap-1">
                                  <XCircle className="w-3 h-3" /> Error
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-gray-400">{entry.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div ref={logEndRef} />
                  </div>
                </section>
              )}

              {/* ── DATA PORT ── */}
              <section className="bg-[#111111] rounded-lg border border-[#1a1a1a] overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a1a1a]">
                  <div className="flex items-center gap-2">
                    <Database className="w-4 h-4 text-orange-400" />
                    <h2 className="text-xs font-bold tracking-wider">DATA PORT</h2>
                  </div>
                </div>
                <div className="p-4 flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-transparent border-[#2a2a2a] text-gray-400 hover:text-gray-200 hover:border-[#3a3a3a] text-[10px] h-7"
                    onClick={handleExportExcel}
                  >
                    <FileSpreadsheet className="w-3 h-3 mr-1.5" />
                    EXPORT EXCEL
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-transparent border-[#2a2a2a] text-gray-400 hover:text-gray-200 hover:border-[#3a3a3a] text-[10px] h-7"
                    onClick={handleExportCSV}
                  >
                    <Download className="w-3 h-3 mr-1.5" />
                    EXPORT CSV
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-transparent border-[#2a2a2a] text-gray-400 hover:text-gray-200 hover:border-[#3a3a3a] text-[10px] h-7"
                    onClick={() => handleDelete(selectedIds)}
                    disabled={selectedIds.size === 0}
                  >
                    <Trash2 className="w-3 h-3 mr-1.5" />
                    DELETE SELECTED
                    {selectedIds.size > 0 && (
                      <span className="ml-1 bg-orange-500/20 text-orange-400 px-1 rounded text-[9px]">{selectedIds.size}</span>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-transparent border-[#2a2a2a] text-gray-400 hover:text-gray-200 hover:border-[#3a3a3a] text-[10px] h-7"
                    onClick={fetchProducts}
                  >
                    <RefreshCw className={`w-3 h-3 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
                    REFRESH
                  </Button>
                </div>
              </section>

              {/* ── LIVE RESULTS TABLE ── */}
              <section className="bg-[#111111] rounded-lg border border-[#1a1a1a] overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a1a1a]">
                  <div className="flex items-center gap-2">
                    <div className="w-1 h-4 bg-orange-500 rounded-full" />
                    <h2 className="text-xs font-bold tracking-wider">LIVE SESSION RESULTS</h2>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-gray-500">
                    <span>{products.length} products</span>
                    <span>•</span>
                    <span>{priceRows} price rows</span>
                  </div>
                </div>

                {isLoading ? (
                  <div className="flex items-center justify-center py-12 text-gray-600">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    <span className="text-xs">Loading data...</span>
                  </div>
                ) : products.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-gray-600">
                    <Package className="w-8 h-8 mb-2 opacity-30" />
                    <span className="text-xs">No products scanned yet</span>
                    <span className="text-[10px] text-gray-700 mt-1">Paste ASINs above and execute a bulk scan</span>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="border-b border-[#1a1a1a] text-gray-500">
                          <th className="text-left px-3 py-2.5 w-8">
                            <Checkbox
                              checked={selectedIds.size === products.length && products.length > 0}
                              onCheckedChange={() => toggleSelectAll(selectedIds, setSelectedIds, products)}
                              className="border-[#3a3a3a] data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500"
                            />
                          </th>
                          <th className="text-left px-3 py-2.5">IMAGE</th>
                          <th className="text-left px-3 py-2.5">ASIN</th>
                          <th className="text-left px-3 py-2.5 min-w-[200px]">PRODUCT NAME</th>
                          {REGIONS.map((r) => (
                            <th key={r.key} className="text-left px-3 py-2.5">
                              <span className="flex items-center gap-1"><span>{r.flag}</span><span>{r.short}</span></span>
                            </th>
                          ))}
                          <th className="text-left px-3 py-2.5">LAST SCAN</th>
                        </tr>
                      </thead>
                      <tbody>
                        {products.map((product) => (
                          <tr key={product.id} className="border-b border-[#1a1a1a]/50 hover:bg-[#1a1a1a]/30 transition-colors">
                            <td className="px-3 py-2.5">
                              <Checkbox
                                checked={selectedIds.has(product.id)}
                                onCheckedChange={() => toggleSelect(product.id, selectedIds, setSelectedIds)}
                                className="border-[#3a3a3a] data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500"
                              />
                            </td>
                            <td className="px-3 py-2.5">
                              {product.image ? (
                                <div className="w-10 h-10 rounded bg-[#1a1a1a] overflow-hidden">
                                  <img src={product.image} alt={product.name} className="w-full h-full object-cover"
                                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                                </div>
                              ) : (
                                <div className="w-10 h-10 rounded bg-[#1a1a1a] flex items-center justify-center">
                                  <Package className="w-4 h-4 text-gray-700" />
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2.5">
                              <span className="bg-orange-500/10 text-orange-400 px-2 py-0.5 rounded font-mono text-[10px]">
                                {product.asin}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-gray-300 max-w-[300px] truncate">{product.name}</td>
                            {REGIONS.map((r) => {
                              const priceInfo = product.prices[r.key]
                              const hasPrice = priceInfo && priceInfo.price !== 'N/A'
                              const domain = priceInfo?.domain || `amazon.${r.key === 'COM' ? 'com' : r.key.toLowerCase()}`
                              const productUrl = `https://www.${domain}/dp/${product.asin}/`
                              return (
                                <td key={r.key} className="px-3 py-2.5">
                                  {hasPrice ? (
                                    <a href={productUrl} target="_blank" rel="noopener noreferrer"
                                      className="text-green-400 font-mono hover:text-green-300 hover:underline underline-offset-2 transition-colors cursor-pointer"
                                      title={`Open on ${domain}`}>
                                      {priceInfo.priceDisplay}
                                    </a>
                                  ) : (
                                    <span className="text-gray-700">N/A</span>
                                  )}
                                </td>
                              )
                            })}
                            <td className="px-3 py-2.5 text-gray-600 text-[10px]">
                              {new Date(product.lastScan).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}

          {/* ═══════════════════════════════════════════════════════════
              HISTORICAL DATA VIEW
          ═══════════════════════════════════════════════════════════ */}
          {viewMode === 'history' && (
            <>
              {/* ── STATS CARDS ── */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-[#111111] rounded-lg border border-[#1a1a1a] p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Archive className="w-3.5 h-3.5 text-orange-400" />
                    <span className="text-[10px] text-gray-500 uppercase tracking-wider">Total Products</span>
                  </div>
                  <div className="text-xl font-bold text-gray-200">{products.length}</div>
                </div>
                <div className="bg-[#111111] rounded-lg border border-[#1a1a1a] p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <TrendingUp className="w-3.5 h-3.5 text-green-400" />
                    <span className="text-[10px] text-gray-500 uppercase tracking-wider">With Prices</span>
                  </div>
                  <div className="text-xl font-bold text-green-400">{productsWithPrices}</div>
                </div>
                <div className="bg-[#111111] rounded-lg border border-[#1a1a1a] p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Globe className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-[10px] text-gray-500 uppercase tracking-wider">Price Rows</span>
                  </div>
                  <div className="text-xl font-bold text-blue-400">{priceRows}</div>
                </div>
                <div className="bg-[#111111] rounded-lg border border-[#1a1a1a] p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Calendar className="w-3.5 h-3.5 text-purple-400" />
                    <span className="text-[10px] text-gray-500 uppercase tracking-wider">Regions Active</span>
                  </div>
                  <div className="text-xl font-bold text-purple-400">{onlineRegions}</div>
                </div>
              </div>

              {/* ── TOOLBAR ── */}
              <section className="bg-[#111111] rounded-lg border border-[#1a1a1a] overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a1a1a]">
                  <div className="flex items-center gap-2">
                    <Archive className="w-4 h-4 text-orange-400" />
                    <h2 className="text-xs font-bold tracking-wider">HISTORICAL DATA ARCHIVE</h2>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-gray-500">
                    <span>{filteredProducts.length} of {products.length} products</span>
                  </div>
                </div>
                <div className="p-4 flex flex-wrap items-center gap-3">
                  {/* Search */}
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-600" />
                    <Input
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                      placeholder="Search ASIN, product name, price..."
                      className="bg-[#0a0a0a] border-[#2a2a2a] text-gray-200 placeholder-gray-600 text-xs h-8 pl-9 font-mono focus:border-orange-500/50 focus:ring-orange-500/20"
                    />
                  </div>

                  {/* Excel Export */}
                  <Button
                    onClick={handleExportExcel}
                    className="bg-green-600 hover:bg-green-700 text-white font-bold text-xs h-8 px-4 shrink-0"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />
                    EXPORT EXCEL
                  </Button>

                  {/* CSV Export */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-transparent border-[#2a2a2a] text-gray-400 hover:text-gray-200 hover:border-[#3a3a3a] text-[10px] h-8"
                    onClick={handleExportCSV}
                  >
                    <Download className="w-3 h-3 mr-1.5" />
                    CSV
                  </Button>

                  {/* Delete selected */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-transparent border-[#2a2a2a] text-gray-400 hover:text-gray-200 hover:border-red-500/50 hover:text-red-400 text-[10px] h-8"
                    onClick={() => handleDelete(historySelectedIds)}
                    disabled={historySelectedIds.size === 0}
                  >
                    <Trash2 className="w-3 h-3 mr-1.5" />
                    DELETE
                    {historySelectedIds.size > 0 && (
                      <span className="ml-1 bg-orange-500/20 text-orange-400 px-1 rounded text-[9px]">{historySelectedIds.size}</span>
                    )}
                  </Button>

                  {/* Refresh */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-transparent border-[#2a2a2a] text-gray-400 hover:text-gray-200 hover:border-[#3a3a3a] text-[10px] h-8"
                    onClick={fetchProducts}
                  >
                    <RefreshCw className={`w-3 h-3 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
                    REFRESH
                  </Button>
                </div>
              </section>

              {/* ── HISTORY TABLE ── */}
              <section className="bg-[#111111] rounded-lg border border-[#1a1a1a] overflow-hidden">
                {isLoading ? (
                  <div className="flex items-center justify-center py-12 text-gray-600">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    <span className="text-xs">Loading historical data...</span>
                  </div>
                ) : sortedProducts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-gray-600">
                    <Archive className="w-8 h-8 mb-2 opacity-30" />
                    <span className="text-xs">{historySearch ? 'No products match your search' : 'No historical data yet'}</span>
                    <span className="text-[10px] text-gray-700 mt-1">
                      {historySearch ? 'Try a different search term' : 'Crawl some ASINs first to build your history'}
                    </span>
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-[calc(100vh-380px)] overflow-y-auto">
                    <table className="w-full text-[11px]">
                      <thead className="sticky top-0 bg-[#111111] z-10">
                        <tr className="border-b border-[#1a1a1a] text-gray-500">
                          <th className="text-left px-3 py-2.5 w-8 bg-[#111111]">
                            <Checkbox
                              checked={historySelectedIds.size === filteredProducts.length && filteredProducts.length > 0}
                              onCheckedChange={() => toggleSelectAll(historySelectedIds, setHistorySelectedIds, filteredProducts)}
                              className="border-[#3a3a3a] data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500"
                            />
                          </th>
                          <th className="text-left px-3 py-2.5 bg-[#111111]">IMAGE</th>
                          <th
                            className="text-left px-3 py-2.5 bg-[#111111] cursor-pointer hover:text-orange-400 transition-colors"
                            onClick={() => handleSort('asin')}
                          >
                            <span className="flex items-center">ASIN <SortIcon field="asin" /></span>
                          </th>
                          <th
                            className="text-left px-3 py-2.5 min-w-[200px] bg-[#111111] cursor-pointer hover:text-orange-400 transition-colors"
                            onClick={() => handleSort('name')}
                          >
                            <span className="flex items-center">PRODUCT NAME <SortIcon field="name" /></span>
                          </th>
                          {REGIONS.map((r) => (
                            <th
                              key={r.key}
                              className="text-left px-3 py-2.5 bg-[#111111] cursor-pointer hover:text-orange-400 transition-colors"
                              onClick={() => handleSort(r.key as SortField)}
                            >
                              <span className="flex items-center gap-1">
                                <span>{r.flag}</span><span>{r.short}</span>
                                <SortIcon field={r.key as SortField} />
                              </span>
                            </th>
                          ))}
                          <th
                            className="text-left px-3 py-2.5 bg-[#111111] cursor-pointer hover:text-orange-400 transition-colors"
                            onClick={() => handleSort('lastScan')}
                          >
                            <span className="flex items-center">LAST SCAN <SortIcon field="lastScan" /></span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedProducts.map((product) => (
                          <tr key={product.id} className="border-b border-[#1a1a1a]/50 hover:bg-[#1a1a1a]/30 transition-colors">
                            <td className="px-3 py-2.5">
                              <Checkbox
                                checked={historySelectedIds.has(product.id)}
                                onCheckedChange={() => toggleSelect(product.id, historySelectedIds, setHistorySelectedIds)}
                                className="border-[#3a3a3a] data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500"
                              />
                            </td>
                            <td className="px-3 py-2.5">
                              {product.image ? (
                                <div className="w-10 h-10 rounded bg-[#1a1a1a] overflow-hidden">
                                  <img src={product.image} alt={product.name} className="w-full h-full object-cover"
                                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                                </div>
                              ) : (
                                <div className="w-10 h-10 rounded bg-[#1a1a1a] flex items-center justify-center">
                                  <Package className="w-4 h-4 text-gray-700" />
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2.5">
                              <span className="bg-orange-500/10 text-orange-400 px-2 py-0.5 rounded font-mono text-[10px]">
                                {product.asin}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-gray-300 max-w-[300px] truncate">{product.name}</td>
                            {REGIONS.map((r) => {
                              const priceInfo = product.prices[r.key]
                              const hasPrice = priceInfo && priceInfo.price !== 'N/A'
                              const domain = priceInfo?.domain || `amazon.${r.key === 'COM' ? 'com' : r.key.toLowerCase()}`
                              const productUrl = `https://www.${domain}/dp/${product.asin}/`
                              return (
                                <td key={r.key} className="px-3 py-2.5">
                                  {hasPrice ? (
                                    <a href={productUrl} target="_blank" rel="noopener noreferrer"
                                      className="text-green-400 font-mono hover:text-green-300 hover:underline underline-offset-2 transition-colors cursor-pointer"
                                      title={`Open on ${domain} — Updated ${new Date(priceInfo.updatedAt).toLocaleString()}`}>
                                      {priceInfo.priceDisplay}
                                    </a>
                                  ) : (
                                    <span className="text-gray-700">N/A</span>
                                  )}
                                </td>
                              )
                            })}
                            <td className="px-3 py-2.5 text-gray-600 text-[10px]">
                              {new Date(product.lastScan).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        {/* ── FOOTER ── */}
        <footer className="bg-[#0f0f0f] border-t border-[#1a1a1a] px-4 py-2 mt-auto">
          <div className="flex items-center justify-between text-[10px] text-gray-600">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1"><Server className="w-3 h-3" /> AOD-ONLY ENGINE</span>
              <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> 5 REGIONS</span>
              <span className="flex items-center gap-1"><Globe className="w-3 h-3" /> COM • EG • DE • SA • AE</span>
            </div>
            <span className="text-gray-700">SupplierCrawl v1.0 — Bulk AOD Scanner</span>
          </div>
        </footer>
      </main>
    </div>
  )
}
