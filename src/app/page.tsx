'use client'

import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import {
  Zap, Download, Trash2, RefreshCw,
  Globe, Activity, Database, Server, ChevronRight,
  Loader2, CheckCircle2, XCircle,
  LayoutDashboard, History, Settings, Shield,
  Package, MapPin, FileText, StopCircle,
  Archive, FileSpreadsheet, Filter, Search,
  Calendar, TrendingUp, ArrowUpDown, ArrowUp, ArrowDown,
  Bug
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

type ViewMode = 'live' | 'history' | 'settings' | 'debug'
type SortField = 'asin' | 'name' | 'lastScan' | 'COM' | 'EG' | 'DE' | 'SA' | 'AE'
type SortDir = 'asc' | 'desc'

interface LogEntry {
  time: string
  asin: string
  status: 'pending' | 'running' | 'done' | 'error'
  message: string
  pricesFound: number
  regionDetails: RegionDetail[]
}

interface RegionDetail {
  region: string
  price: string
  priceDisplay: string
  status: 'success' | 'error' | 'na'
  debug: {
    url: string
    crawleoHttpStatus: number
    pageStatusCode: number
    htmlSize: number
    markdownSize: number
    credits: number
    timingMs: number
    retryCount: number
    errorMsg: string
    aodOfferCount: number
    aPriceCount: number
    parseStrategy: string
    rawPriceText: string
  } | null
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
  const [crawleoApiKey, setCrawleoApiKey] = useState('')
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [apiKeySaved, setApiKeySaved] = useState(false)
  const [dbSetupNeeded, setDbSetupNeeded] = useState(false)
  const [setupSql, setSetupSql] = useState('')
  const [showSetup, setShowSetup] = useState(false)
  const [expandedLogIdx, setExpandedLogIdx] = useState<number | null>(null)
  const abortRef = useRef(false)
  const logEndRef = useRef<HTMLDivElement>(null)

  // History-specific state
  const [historySearch, setHistorySearch] = useState('')
  const [sortField, setSortField] = useState<SortField>('lastScan')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [historySelectedIds, setHistorySelectedIds] = useState<Set<string>>(new Set())

  // Debug logs state
  const [debugLogs, setDebugLogs] = useState<any[]>([])
  const [debugLoading, setDebugLoading] = useState(false)
  const [expandedDebugId, setExpandedDebugId] = useState<string | null>(null)
  const [debugFilter, setDebugFilter] = useState<'all' | 'error' | 'success' | 'na'>('all')

  // API test state
  const [apiTestRunning, setApiTestRunning] = useState(false)
  const [apiTestResults, setApiTestResults] = useState<Array<{ step: string; status: string; details: string; timingMs: number }>>([])
  const [showApiTest, setShowApiTest] = useState(false)

  const { toast } = useToast()

  // Default Crawleo API key from env
  const DEFAULT_CRAWLEO_KEY = process.env.NEXT_PUBLIC_CRAWLEO_API_KEY || ''

  // Load Crawleo API key from localStorage (fall back to env key)
  useEffect(() => {
    const savedKey = localStorage.getItem('crawleo_api_key') || DEFAULT_CRAWLEO_KEY
    setCrawleoApiKey(savedKey)
    setApiKeyDraft(savedKey)
    if (!localStorage.getItem('crawleo_api_key') && DEFAULT_CRAWLEO_KEY) {
      localStorage.setItem('crawleo_api_key', DEFAULT_CRAWLEO_KEY)
    }
  }, [])

  // Save API key permanently to localStorage
  const handleSaveApiKey = () => {
    const key = apiKeyDraft.trim()
    setCrawleoApiKey(key)
    localStorage.setItem('crawleo_api_key', key)
    setApiKeySaved(true)
    toast({
      title: 'API Key Saved',
      description: key ? 'Crawleo API key saved permanently' : 'API key cleared',
    })
    setTimeout(() => setApiKeySaved(false), 2000)
  }

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
        setDbSetupNeeded(false)
      } else if (data.error && (data.error.includes('Could not find the table') || data.error.includes('does not exist') || data.needsSetup)) {
        setDbSetupNeeded(true)
        // Fetch the SQL migration
        try {
          const setupRes = await fetch('/api/setup')
          const setupData = await setupRes.json()
          if (setupData.sql) setSetupSql(setupData.sql)
        } catch {}
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

  // Fetch debug logs from server
  const fetchDebugLogs = useCallback(async () => {
    setDebugLoading(true)
    try {
      const res = await fetch('/api/logs?limit=100')
      const data = await res.json()
      if (data.success) {
        setDebugLogs(data.logs)
      }
    } catch (e) {
      console.error('Failed to fetch debug logs:', e)
    } finally {
      setDebugLoading(false)
    }
  }, [])

  // Test Crawleo API key
  const handleTestApiKey = async () => {
    if (!crawleoApiKey) {
      toast({ title: 'No API Key', description: 'Enter your Crawleo API key first', variant: 'destructive' })
      return
    }
    setApiTestRunning(true)
    setApiTestResults([])
    setShowApiTest(true)
    try {
      const res = await fetch(`/api/test-crawleo?apiKey=${encodeURIComponent(crawleoApiKey)}`)
      const data = await res.json()
      if (data.results) {
        setApiTestResults(data.results)
        const successCount = data.results.filter((r: any) => r.status === 'success').length
        toast({
          title: successCount >= 2 ? 'API Key Works!' : 'API Key Issues Detected',
          description: `${successCount}/${data.results.length} tests passed`,
          variant: successCount >= 2 ? 'default' : 'destructive',
        })
      }
    } catch (e) {
      setApiTestResults([{ step: 'Error', status: 'error', details: `Failed to run test: ${e instanceof Error ? e.message : String(e)}`, timingMs: 0 }])
    } finally {
      setApiTestRunning(false)
    }
  }

  // ── Timestamp helper ──
  const ts = () =>
    new Date().toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })

  // ── Bulk Crawl Handler (ONE request per region for reliability) ──
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

    // API key is now optional — page_reader is used by default
    // Crawleo API key is only needed as a fallback method

    setIsCrawling(true)
    abortRef.current = false
    const regionKeys = ['COM', 'EG', 'DE', 'SA', 'AE']
    setCrawlTotal(uniqueAsins.length * regionKeys.length)
    setCrawlCurrent(0)
    setCrawlLog([])

    const initLogs: LogEntry[] = uniqueAsins.map((asin) => ({
      time: ts(),
      asin,
      status: 'pending',
      message: `Queued (${regionKeys.length} regions)`,
      pricesFound: 0,
      regionDetails: [],
    }))
    setCrawlLog(initLogs)

    let totalPricesFound = 0
    let regionIdx = 0

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
      let pricesFound = 0
      const regionResults: string[] = []
      const regionDetails: RegionDetail[] = []

      // Set log to running for this ASIN
      setCrawlLog((prev) =>
        prev.map((entry, idx) =>
          idx === i ? { ...entry, status: 'running', message: `Scanning 0/${regionKeys.length} regions...`, time: ts(), regionDetails: [] } : entry
        )
      )

      // Crawl each region INDIVIDUALLY — one API call per region (~10-20s each)
      const crawlResults: Array<{ domain: string; region: string; name: string; image: string; price: string; currency: string; priceDisplay: string; asin: string; error?: string; debug?: RegionDetail['debug'] }> = []

      for (let r = 0; r < regionKeys.length; r++) {
        if (abortRef.current) break

        const regionKey = regionKeys[r]
        regionIdx++
        setCrawlCurrent(regionIdx)

        // Update log to show progress
        setCrawlLog((prev) =>
          prev.map((entry, idx) =>
            idx === i ? { ...entry, status: 'running', message: `Scanning ${r + 1}/${regionKeys.length} regions (${regionKey})...`, time: ts() } : entry
          )
        )

        try {
          // Call the Next.js API which crawls via Crawleo directly (TypeScript)
          const res = await fetch('/api/crawl', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              asin,
              region: regionKey,
              crawleoApiKey: crawleoApiKey || undefined,
            }),
          })

          const data = await res.json()

          if (data.success && data.results && data.results.length > 0) {
            const result = data.results[0]
            crawlResults.push(result)

            if (result.price !== 'N/A') {
              pricesFound++
              regionResults.push(`${regionKey}: ${result.priceDisplay}`)
              regionDetails.push({ region: regionKey, price: result.price, priceDisplay: result.priceDisplay, status: 'success', debug: result.debug || null })
            } else {
              regionResults.push(`${regionKey}: N/A`)
              regionDetails.push({ region: regionKey, price: 'N/A', priceDisplay: 'N/A', status: 'na', debug: result.debug || null })
            }
          } else {
            const errResult = { domain: '', region: regionKey, name: `Product ${asin}`, image: '', price: 'N/A', currency: '', priceDisplay: 'N/A', asin, error: data.error || 'Crawl failed', debug: data.results?.[0]?.debug || null }
            crawlResults.push(errResult)
            regionResults.push(`${regionKey}: Error`)
            regionDetails.push({ region: regionKey, price: 'N/A', priceDisplay: 'N/A', status: 'error', debug: data.results?.[0]?.debug || null })
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : 'Network error'
          const errResult = { domain: '', region: regionKey, name: `Product ${asin}`, image: '', price: 'N/A', currency: '', priceDisplay: 'N/A', asin, error: errMsg }
          crawlResults.push(errResult)
          regionResults.push(`${regionKey}: NetErr`)
          regionDetails.push({ region: regionKey, price: 'N/A', priceDisplay: 'N/A', status: 'error', debug: null })
          console.error(`[Crawl] ${asin} on ${regionKey} failed:`, errMsg)
        }

        // Refresh products after each region so user sees live updates
        await fetchProducts()

        // Small delay between regions
        if (r < regionKeys.length - 1) {
          await new Promise((r2) => setTimeout(r2, 300))
        }
      }

      totalPricesFound += pricesFound

      if (abortRef.current) {
        setCrawlLog((prev) =>
          prev.map((entry, idx) =>
            idx === i
              ? { ...entry, status: 'error', message: `Aborted — ${pricesFound}/5 found — ${regionResults.join(' | ')}`, pricesFound, regionDetails, time: ts() }
              : entry
          )
        )
      } else {
        setCrawlLog((prev) =>
          prev.map((entry, idx) =>
            idx === i
              ? { ...entry, status: 'done', message: `${pricesFound}/5 prices found — ${regionResults.join(' | ')}`, pricesFound, regionDetails, time: ts() }
              : entry
            )
          )
      }

      await fetchProducts()

      if (i < uniqueAsins.length - 1 && !abortRef.current) {
        await new Promise((r) => setTimeout(r, 2000))
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
          <button
            onClick={() => setViewMode('settings')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded text-xs transition-colors ${
              viewMode === 'settings'
                ? 'bg-orange-500/10 text-orange-400'
                : 'text-gray-500 hover:text-gray-300 hover:bg-[#1a1a1a]'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            API Config
            {viewMode === 'settings' && <ChevronRight className="w-3 h-3 ml-auto" />}
          </button>
          <button
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded text-xs text-gray-500 hover:text-gray-300 hover:bg-[#1a1a1a] transition-colors"
          >
            <Shield className="w-3.5 h-3.5" />
            Proxy Health
          </button>
          <button
            onClick={() => { setViewMode('debug'); fetchDebugLogs() }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded text-xs transition-colors ${
              viewMode === 'debug'
                ? 'bg-orange-500/10 text-orange-400'
                : 'text-gray-500 hover:text-gray-300 hover:bg-[#1a1a1a]'
            }`}
          >
            <Bug className="w-3.5 h-3.5" />
            Debug Logs
            {viewMode === 'debug' && <ChevronRight className="w-3 h-3 ml-auto" />}
          </button>
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
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setViewMode('settings')}
                className={`h-6 text-[10px] px-3 rounded ${
                  viewMode === 'settings'
                    ? 'bg-orange-500 text-black hover:bg-orange-600'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <Settings className="w-3 h-3 mr-1" />
                SETTINGS
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setViewMode('debug'); fetchDebugLogs() }}
                className={`h-6 text-[10px] px-3 rounded ${
                  viewMode === 'debug'
                    ? 'bg-orange-500 text-black hover:bg-orange-600'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <Bug className="w-3 h-3 mr-1" />
                DEBUG
              </Button>
            </div>
          </div>
        </header>

        {/* ── CONTENT ── */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* ── DATABASE SETUP BANNER ── */}
          {dbSetupNeeded && (
            <section className="bg-red-500/10 rounded-lg border border-red-500/30 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-red-500/20">
                <Database className="w-4 h-4 text-red-400" />
                <h2 className="text-xs font-bold tracking-wider text-red-400">DATABASE SETUP REQUIRED</h2>
              </div>
              <div className="p-4 space-y-3">
                <p className="text-xs text-gray-400">
                  The Supabase database tables need to be created. Follow these steps:
                </p>
                <ol className="text-xs text-gray-400 space-y-1 list-decimal ml-4">
                  <li>Open the <a href="https://supabase.com/dashboard/project/vrnpfmuzpvycewbuikxj/sql/new" target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:underline">Supabase SQL Editor</a></li>
                  <li>Click the button below to copy the SQL migration</li>
                  <li>Paste it in the SQL Editor and click <strong className="text-gray-200">Run</strong></li>
                  <li>Come back here and click <strong className="text-gray-200">Refresh</strong></li>
                </ol>
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-transparent border-red-500/50 text-red-400 hover:bg-red-500/10 text-xs h-7"
                    onClick={() => setShowSetup(!showSetup)}
                  >
                    {showSetup ? 'HIDE SQL' : 'SHOW SQL'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-transparent border-[#2a2a2a] text-gray-400 hover:text-gray-200 hover:border-[#3a3a3a] text-xs h-7"
                    onClick={() => {
                      navigator.clipboard.writeText(setupSql)
                      toast({ title: 'SQL Copied!', description: 'Paste it in the Supabase SQL Editor' })
                    }}
                    disabled={!setupSql}
                  >
                    <FileText className="w-3 h-3 mr-1.5" />
                    COPY SQL TO CLIPBOARD
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-transparent border-[#2a2a2a] text-gray-400 hover:text-gray-200 hover:border-[#3a3a3a] text-xs h-7"
                    onClick={fetchProducts}
                  >
                    <RefreshCw className="w-3 h-3 mr-1.5" />
                    REFRESH
                  </Button>
                </div>
                {showSetup && setupSql && (
                  <pre className="bg-[#0a0a0a] border border-[#2a2a2a] rounded p-3 text-[10px] text-gray-400 max-h-64 overflow-auto whitespace-pre-wrap">
                    {setupSql}
                  </pre>
                )}
              </div>
            </section>
          )}

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
                      {isCrawling ? `SCANNING ${crawlCurrent}/${crawlTotal} REGIONS...` : 'EXECUTE BULK SCAN'}
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
                      Built-in page reader • 1 request per region • AOD-only prices
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
                          <Fragment key={`${entry.asin}-${idx}`}>
                          <tr
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
                            <td className="px-3 py-1.5 text-gray-400">
                              <div className="flex items-center gap-2">
                                <span>{entry.message}</span>
                                {entry.regionDetails.length > 0 && (
                                  <button
                                    onClick={() => setExpandedLogIdx(expandedLogIdx === idx ? null : idx)}
                                    className="text-orange-400 hover:text-orange-300 text-[9px] font-bold shrink-0"
                                  >
                                    {expandedLogIdx === idx ? '▲ HIDE' : '▼ DEBUG'}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                          {/* Expanded debug details */}
                          {expandedLogIdx === idx && entry.regionDetails.length > 0 && (
                            <tr>
                              <td colSpan={4} className="px-0 py-0">
                                <div className="bg-[#080808] border-t border-b border-[#2a2a2a] p-3">
                                  <table className="w-full text-[10px]">
                                    <thead>
                                      <tr className="text-gray-600">
                                        <th className="text-left px-2 py-1 w-14">Region</th>
                                        <th className="text-left px-2 py-1 w-20">Price</th>
                                        <th className="text-left px-2 py-1 w-16">Status</th>
                                        <th className="text-left px-2 py-1">Debug Details</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {entry.regionDetails.map((rd, ridx) => (
                                        <tr key={ridx} className={`border-t border-[#1a1a1a]/50 ${rd.status === 'success' ? 'bg-green-500/5' : rd.status === 'error' ? 'bg-red-500/5' : 'bg-yellow-500/5'}`}>
                                          <td className="px-2 py-1.5">
                                            <span className={`font-bold ${rd.status === 'success' ? 'text-green-400' : rd.status === 'error' ? 'text-red-400' : 'text-yellow-400'}`}>
                                              {rd.region}
                                            </span>
                                          </td>
                                          <td className="px-2 py-1.5 text-gray-300 font-mono">
                                            {rd.priceDisplay}
                                          </td>
                                          <td className="px-2 py-1.5">
                                            {rd.status === 'success' && <span className="text-green-400">✓ Found</span>}
                                            {rd.status === 'na' && <span className="text-yellow-400">— N/A</span>}
                                            {rd.status === 'error' && <span className="text-red-400">✗ Error</span>}
                                          </td>
                                          <td className="px-2 py-1.5">
                                            {rd.debug ? (
                                              <div className="space-y-0.5 font-mono text-[9px]">
                                                <div className="text-gray-500">
                                                  URL: <span className="text-gray-400">{rd.debug.url}</span>
                                                </div>
                                                <div className="text-gray-500">
                                                  Crawleo: <span className={rd.debug.crawleoHttpStatus === 200 ? 'text-green-400' : 'text-red-400'}>HTTP {rd.debug.crawleoHttpStatus}</span>
                                                  {' | '}
                                                  Page: <span className={rd.debug.pageStatusCode === 200 ? 'text-green-400' : rd.debug.pageStatusCode === 404 ? 'text-yellow-400' : 'text-red-400'}>HTTP {rd.debug.pageStatusCode}</span>
                                                  {' | '}
                                                  HTML: <span className="text-gray-400">{rd.debug.htmlSize.toLocaleString()} chars</span>
                                                  {' | '}
                                                  Time: <span className="text-gray-400">{(rd.debug.timingMs / 1000).toFixed(1)}s</span>
                                                </div>
                                                {rd.debug.errorMsg && (
                                                  <div className="text-red-400">
                                                    Error: {rd.debug.errorMsg}
                                                  </div>
                                                )}
                                                <div className="text-gray-500">
                                                  Parse: <span className="text-gray-400">{rd.debug.parseStrategy || 'none'}</span>
                                                  {rd.debug.rawPriceText && (
                                                    <> | Raw: <span className="text-gray-400">"{rd.debug.rawPriceText}"</span></>
                                                  )}
                                                  {' | '}
                                                  AOD offers: <span className="text-gray-400">{rd.debug.aodOfferCount}</span>
                                                  {' | '}
                                                  a-price: <span className="text-gray-400">{rd.debug.aPriceCount}</span>
                                                  {' | '}
                                                  Credits: <span className="text-gray-400">{rd.debug.credits}</span>
                                                </div>
                                              </div>
                                            ) : (
                                              <span className="text-gray-600 text-[9px]">No debug info (likely network error — check browser console)</span>
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                          </Fragment>
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

          {/* ═══════════════════════════════════════════════════════════
              SETTINGS / API CONFIG VIEW
          ═══════════════════════════════════════════════════════════ */}
          {viewMode === 'settings' && (
            <>
              {/* ── CRAWLEO API KEY ── */}
              <section className="bg-[#111111] rounded-lg border border-[#1a1a1a] overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a]">
                  <Shield className="w-4 h-4 text-orange-400" />
                  <h2 className="text-xs font-bold tracking-wider">API CONFIG (OPTIONAL FALLBACK)</h2>
                  {crawleoApiKey && !apiKeySaved && (
                    <span className="text-[9px] text-green-400 flex items-center gap-1 ml-2">
                      <CheckCircle2 className="w-3 h-3" /> Active
                    </span>
                  )}
                  {apiKeySaved && (
                    <span className="text-[9px] text-green-300 flex items-center gap-1 ml-2 animate-pulse">
                      <CheckCircle2 className="w-3 h-3" /> Saved!
                    </span>
                  )}
                </div>
                <div className="p-5 space-y-4">
                  <div className="bg-green-500/10 border border-green-500/30 rounded-md p-3 mb-3">
                    <p className="text-xs text-green-400 font-bold mb-1">✅ Built-in Page Reader Active</p>
                    <p className="text-xs text-gray-400">
                      The app now uses a built-in page reader (no API key needed!) to fetch Amazon offer-listing pages. 
                      A Crawleo API key is only needed as an optional fallback method.
                    </p>
                  </div>
                  <p className="text-xs text-gray-400">
                    Optional: Enter a Crawleo API key to use as a fallback crawling method. 
                    Your key is saved in your browser's local storage and persists across sessions.
                  </p>
                  <div className="space-y-2">
                    <label className="text-[10px] text-gray-500 uppercase tracking-wider">API Key</label>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 relative">
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600">
                          <Shield className="w-3.5 h-3.5" />
                        </div>
                        <input
                          type="password"
                          value={apiKeyDraft}
                          onChange={(e) => setApiKeyDraft(e.target.value)}
                          placeholder="sk_xxxxxxxx_xxxxxxxxxxxxxxxx"
                          className="w-full bg-[#0a0a0a] border border-[#2a2a2a] text-gray-200 placeholder-gray-600 text-xs font-mono pl-9 pr-3 py-2.5 rounded-md focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/20 focus:outline-none"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveApiKey()
                          }}
                        />
                      </div>
                      <Button
                        onClick={handleSaveApiKey}
                        className="bg-orange-500 hover:bg-orange-600 text-black font-bold text-xs h-10 px-5 shrink-0"
                        disabled={apiKeyDraft.trim() === crawleoApiKey}
                      >
                        {apiKeySaved ? (
                          <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                        ) : null}
                        {apiKeySaved ? 'SAVED' : 'SAVE KEY'}
                      </Button>
                    </div>
                    {apiKeyDraft && (
                      <p className="text-[10px] text-gray-600">
                        Key: {apiKeyDraft.slice(0, 8)}{'•'.repeat(20)}{apiKeyDraft.slice(-4)}
                      </p>
                    )}
                  </div>

                  <div className="border-t border-[#1a1a1a] pt-4">
                    <h3 className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Optional: Crawleo API Key</h3>
                    <p className="text-xs text-gray-500 mb-2">
                      If you have a Crawleo API key, you can add it as a fallback method. This is <strong>not required</strong> — the built-in page reader works without any key.
                    </p>
                    <ol className="text-xs text-gray-500 space-y-1.5 list-decimal ml-4">
                      <li>Visit <a href="https://crawleo.dev" target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:underline">crawleo.dev</a> and sign up</li>
                      <li>Go to your dashboard and copy your API key</li>
                      <li>Paste it above and click <strong className="text-gray-300">Save Key</strong></li>
                    </ol>
                  </div>

                  <div className="flex items-center gap-3 border-t border-[#1a1a1a] pt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      className="bg-transparent border-[#2a2a2a] text-gray-400 hover:text-gray-200 hover:border-[#3a3a3a] text-[10px] h-7"
                      onClick={() => {
                        setApiKeyDraft('')
                        setCrawleoApiKey('')
                        localStorage.removeItem('crawleo_api_key')
                        toast({ title: 'API Key Cleared', description: 'Key removed from storage' })
                      }}
                    >
                      <Trash2 className="w-3 h-3 mr-1.5" />
                      CLEAR KEY
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="bg-transparent border-[#2a2a2a] text-gray-400 hover:text-gray-200 hover:border-[#3a3a3a] text-[10px] h-7"
                      onClick={() => setViewMode('live')}
                    >
                      ← BACK TO LIVE MONITOR
                    </Button>
                  </div>
                </div>
              </section>

              {/* ── SUPABASE STATUS ── */}
              <section className="bg-[#111111] rounded-lg border border-[#1a1a1a] overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a]">
                  <Database className="w-4 h-4 text-orange-400" />
                  <h2 className="text-xs font-bold tracking-wider">SUPABASE CONNECTION</h2>
                </div>
                <div className="p-5 space-y-3">
                  <div className="flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full ${dbSetupNeeded ? 'bg-red-500' : 'bg-green-500'}`} />
                    <span className={`text-xs ${dbSetupNeeded ? 'text-red-400' : 'text-green-400'}`}>
                      {dbSetupNeeded ? 'Tables not found — setup required' : 'Connected — tables ready'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">
                    Supabase URL: <code className="text-gray-400 text-[10px]">vrnpfmuzpvycewbuikxj.supabase.co</code>
                  </p>
                  <p className="text-[10px] text-gray-600">
                    Database credentials are configured via environment variables and are not exposed in the UI.
                  </p>
                </div>
              </section>

              {/* ── REGIONS INFO ── */}
              <section className="bg-[#111111] rounded-lg border border-[#1a1a1a] overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a]">
                  <Globe className="w-4 h-4 text-orange-400" />
                  <h2 className="text-xs font-bold tracking-wider">ACTIVE REGIONS</h2>
                </div>
                <div className="p-5">
                  <div className="grid grid-cols-5 gap-3">
                    {REGIONS.map((r) => (
                      <div key={r.key} className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-md p-3 text-center">
                        <div className="text-2xl mb-1">{r.flag}</div>
                        <div className="text-xs text-gray-300 font-bold">{r.short}</div>
                        <div className="text-[10px] text-gray-600">{r.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </>
          )}

{/* ═══════════════════════════════════════════════════════════
    DEBUG LOGS VIEW
═══════════════════════════════════════════════════════════ */}
{viewMode === 'debug' && (
  <>
    {/* ── HEADER WITH CONTROLS ── */}
    <section className="bg-[#111111] rounded-lg border border-[#1a1a1a] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a1a1a]">
        <div className="flex items-center gap-2">
          <Bug className="w-4 h-4 text-orange-400" />
          <h2 className="text-xs font-bold tracking-wider">DEBUG LOGS</h2>
          <span className="text-[10px] text-gray-500">{debugLogs.length} entries</span>
        </div>
        <div className="flex items-center gap-2">
          {(['all', 'error', 'success', 'na'] as const).map(f => (
            <button
              key={f}
              onClick={() => setDebugFilter(f)}
              className={`px-2 py-1 rounded text-[10px] font-bold ${
                debugFilter === f
                  ? 'bg-orange-500 text-black'
                  : 'bg-[#1a1a1a] text-gray-500 hover:text-gray-300'
              }`}
            >
              {f === 'all' ? 'ALL' : f === 'error' ? 'ERRORS' : f === 'success' ? 'FOUND' : 'N/A'}
            </button>
          ))}
          <Button
            variant="outline"
            size="sm"
            className={`bg-transparent border-orange-500/50 text-orange-400 hover:bg-orange-500/10 text-[10px] h-6 ${apiTestRunning ? 'opacity-50' : ''}`}
            onClick={handleTestApiKey}
            disabled={apiTestRunning}
          >
            {apiTestRunning ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Zap className="w-3 h-3 mr-1" />}
            TEST API
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="bg-transparent border-[#2a2a2a] text-gray-400 hover:text-gray-200 hover:border-[#3a3a3a] text-[10px] h-6"
            onClick={fetchDebugLogs}
            disabled={debugLoading}
          >
            <RefreshCw className={`w-3 h-3 mr-1 ${debugLoading ? 'animate-spin' : ''}`} />
            REFRESH
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="bg-transparent border-red-500/50 text-red-400 hover:bg-red-500/10 text-[10px] h-6"
            onClick={async () => {
              await fetch('/api/logs', { method: 'DELETE' })
              setDebugLogs([])
              toast({ title: 'Logs Cleared' })
            }}
          >
            <Trash2 className="w-3 h-3 mr-1" />
            CLEAR
          </Button>
        </div>
      </div>
    </section>

    {/* ── API TEST RESULTS ── */}
    {showApiTest && apiTestResults.length > 0 && (
      <section className="bg-[#111111] rounded-lg border border-[#1a1a1a] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a1a1a]">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-orange-400" />
            <h2 className="text-xs font-bold tracking-wider">CRAWLEO API TEST</h2>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
              apiTestResults.every(r => r.status === 'success') ? 'bg-green-500/10 text-green-400' :
              apiTestResults.some(r => r.status === 'success') ? 'bg-yellow-500/10 text-yellow-400' :
              'bg-red-500/10 text-red-400'
            }`}>
              {apiTestResults.filter(r => r.status === 'success').length}/{apiTestResults.length} PASSED
            </span>
          </div>
          <button
            onClick={() => setShowApiTest(false)}
            className="text-gray-500 hover:text-gray-300 text-[10px]"
          >
            ✕ CLOSE
          </button>
        </div>
        <div className="p-3 space-y-2">
          {apiTestResults.map((r, i) => (
            <div key={i} className={`flex items-start gap-3 px-3 py-2 rounded border ${
              r.status === 'success' ? 'bg-green-500/5 border-green-500/20' :
              r.status === 'error' ? 'bg-red-500/5 border-red-500/20' :
              'bg-[#1a1a1a] border-[#2a2a2a]'
            }`}>
              <span className={`shrink-0 mt-0.5 ${
                r.status === 'success' ? 'text-green-400' :
                r.status === 'error' ? 'text-red-400' :
                'text-yellow-400'
              }`}>
                {r.status === 'success' ? '✓' : r.status === 'error' ? '✗' : '⏳'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-gray-300">{r.step}</span>
                  {r.timingMs > 0 && (
                    <span className="text-[9px] text-gray-600">{(r.timingMs / 1000).toFixed(1)}s</span>
                  )}
                </div>
                <p className="text-[10px] text-gray-400 mt-0.5 break-all">{r.details}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    )}

    {/* ── LOG ENTRIES ── */}
    {debugLoading && debugLogs.length === 0 ? (
      <div className="bg-[#111111] rounded-lg border border-[#1a1a1a] p-8 text-center">
        <Loader2 className="w-6 h-6 animate-spin mx-auto text-orange-400 mb-2" />
        <p className="text-xs text-gray-500">Loading debug logs...</p>
      </div>
    ) : debugLogs.length === 0 ? (
      <div className="bg-[#111111] rounded-lg border border-[#1a1a1a] p-8 text-center">
        <Bug className="w-8 h-8 mx-auto text-gray-700 mb-3" />
        <p className="text-xs text-gray-500 mb-1">No debug logs yet</p>
        <p className="text-[10px] text-gray-600">Crawl some ASINs first, then check here for detailed logs</p>
      </div>
    ) : (
      <div className="space-y-2 max-h-[calc(100vh-200px)] overflow-y-auto">
        {debugLogs
          .filter(log => {
            if (debugFilter === 'all') return true
            if (debugFilter === 'error') return log.result?.error || log.response?.errorMsg
            if (debugFilter === 'success') return log.result?.price && log.result.price !== 'N/A'
            if (debugFilter === 'na') return log.result?.price === 'N/A' && !log.result?.error
            return true
          })
          .map((log) => {
            const isExpanded = expandedDebugId === log.id
            const hasError = log.result?.error || log.response?.errorMsg
            const hasPrice = log.result?.price && log.result.price !== 'N/A'
            
            return (
              <div key={log.id} className={`bg-[#111111] rounded-lg border overflow-hidden ${
                hasError ? 'border-red-500/30' : hasPrice ? 'border-green-500/30' : 'border-yellow-500/30'
              }`}>
                {/* Summary row */}
                <div
                  className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-[#1a1a1a] transition-colors"
                  onClick={() => setExpandedDebugId(isExpanded ? null : log.id)}
                >
                  {/* Status indicator */}
                  <div className={`w-2 h-2 rounded-full shrink-0 ${
                    hasError ? 'bg-red-500' : hasPrice ? 'bg-green-500' : 'bg-yellow-500'
                  }`} />
                  
                  {/* Time */}
                  <span className="text-[10px] text-gray-600 w-36 shrink-0">
                    {new Date(log.timestamp).toLocaleString()}
                  </span>
                  
                  {/* Region */}
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    log.region === 'COM' ? 'bg-blue-500/10 text-blue-400' :
                    log.region === 'EG' ? 'bg-green-500/10 text-green-400' :
                    log.region === 'DE' ? 'bg-yellow-500/10 text-yellow-400' :
                    log.region === 'SA' ? 'bg-purple-500/10 text-purple-400' :
                    log.region === 'AE' ? 'bg-cyan-500/10 text-cyan-400' :
                    'bg-gray-500/10 text-gray-400'
                  }`}>
                    {log.region}
                  </span>
                  
                  {/* ASIN */}
                  <span className="text-[10px] text-orange-400 font-mono">{log.asin}</span>
                  
                  {/* Price */}
                  <span className={`text-[11px] font-mono font-bold ${
                    hasError ? 'text-red-400' : hasPrice ? 'text-green-400' : 'text-yellow-400'
                  }`}>
                    {hasError ? `ERROR: ${(log.result?.error || log.response?.errorMsg)?.slice(0, 60)}` : log.result?.priceDisplay || 'N/A'}
                  </span>
                  
                  {/* Strategy */}
                  {log.parsing?.strategy && (
                    <span className="text-[9px] text-gray-600 bg-[#1a1a1a] px-1.5 py-0.5 rounded">
                      {log.parsing.strategy}
                    </span>
                  )}
                  
                  {/* Timing */}
                  <span className="text-[10px] text-gray-600 ml-auto">
                    {(log.response?.timingMs / 1000).toFixed(1)}s
                  </span>
                  
                  {/* Expand arrow */}
                  <span className="text-gray-600 text-[10px]">
                    {isExpanded ? '▲' : '▼'}
                  </span>
                </div>
                
                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-[#1a1a1a] bg-[#080808] p-4 space-y-4">
                    {/* Request details */}
                    <div>
                      <h4 className="text-[10px] font-bold text-orange-400 tracking-wider mb-2">REQUEST</h4>
                      <div className="bg-[#0a0a0a] rounded border border-[#1a1a1a] p-3 text-[10px] font-mono space-y-1">
                        <div><span className="text-gray-500">Target URL:</span> <span className="text-gray-300">{log.request?.targetUrl}</span></div>
                        <div><span className="text-gray-500">Crawleo API:</span> <span className="text-gray-300">{log.request?.crawleoApiUrl?.slice(0, 120)}...</span></div>
                        <div><span className="text-gray-500">Geolocation:</span> <span className="text-gray-300">{log.request?.geolocation}</span></div>
                        <div><span className="text-gray-500">API Key:</span> <span className="text-gray-300">{log.request?.apiKeyPrefix}</span></div>
                      </div>
                    </div>
                    
                    {/* Response details */}
                    <div>
                      <h4 className="text-[10px] font-bold text-orange-400 tracking-wider mb-2">RESPONSE</h4>
                      <div className="bg-[#0a0a0a] rounded border border-[#1a1a1a] p-3 text-[10px] font-mono space-y-1">
                        <div>
                          <span className="text-gray-500">Crawleo Status:</span>{' '}
                          <span className={log.response?.crawleoHttpStatus === 200 ? 'text-green-400' : 'text-red-400'}>
                            HTTP {log.response?.crawleoHttpStatus}
                          </span>
                          {' | '}
                          <span className="text-gray-500">Page Status:</span>{' '}
                          <span className={log.response?.pageStatusCode === 200 ? 'text-green-400' : 'text-yellow-400'}>
                            HTTP {log.response?.pageStatusCode}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-500">Timing:</span> <span className="text-gray-300">{(log.response?.timingMs / 1000).toFixed(1)}s</span>
                          {' | '}
                          <span className="text-gray-500">Credits:</span> <span className="text-gray-300">{log.response?.credits}</span>
                          {' | '}
                          <span className="text-gray-500">Retries:</span> <span className="text-gray-300">{log.response?.retryCount}</span>
                        </div>
                        {log.response?.errorMsg && (
                          <div className="text-red-400">
                            Error: {log.response.errorMsg}
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {/* Content analysis */}
                    <div>
                      <h4 className="text-[10px] font-bold text-orange-400 tracking-wider mb-2">CONTENT ANALYSIS</h4>
                      <div className="bg-[#0a0a0a] rounded border border-[#1a1a1a] p-3 text-[10px] font-mono space-y-1">
                        <div>
                          <span className="text-gray-500">HTML Size:</span> <span className="text-gray-300">{log.content?.htmlSize?.toLocaleString()} chars</span>
                          {' | '}
                          <span className="text-gray-500">Markdown Size:</span> <span className="text-gray-300">{log.content?.markdownSize?.toLocaleString()} chars</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Page Title:</span> <span className="text-gray-300">{log.content?.title}</span>
                        </div>
                        <div className="flex gap-3">
                          <span className={log.content?.hasOfferListing ? 'text-green-400' : 'text-red-400'}>
                            {log.content?.hasOfferListing ? '✓' : '✗'} Offer Listing
                          </span>
                          <span className={log.content?.hasAodContainer ? 'text-green-400' : 'text-red-400'}>
                            {log.content?.hasAodContainer ? '✓' : '✗'} AOD Container
                          </span>
                          <span className={log.content?.hasPriceElements ? 'text-green-400' : 'text-red-400'}>
                            {log.content?.hasPriceElements ? '✓' : '✗'} Price Elements
                          </span>
                          <span className={log.content?.detectedNoOffers ? 'text-yellow-400' : 'text-gray-600'}>
                            {log.content?.detectedNoOffers ? '⚠' : '—'} No Offers
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    {/* Parsing strategy log */}
                    <div>
                      <h4 className="text-[10px] font-bold text-orange-400 tracking-wider mb-2">PARSING STRATEGIES</h4>
                      <div className="bg-[#0a0a0a] rounded border border-[#1a1a1a] overflow-hidden">
                        <table className="w-full text-[10px]">
                          <thead>
                            <tr className="border-b border-[#1a1a1a] text-gray-600">
                              <th className="text-left px-3 py-1.5 w-32">Strategy</th>
                              <th className="text-left px-3 py-1.5 w-16">Matched</th>
                              <th className="text-left px-3 py-1.5">Raw Match</th>
                              <th className="text-left px-3 py-1.5 w-20">Parsed</th>
                              <th className="text-left px-3 py-1.5">Notes</th>
                            </tr>
                          </thead>
                          <tbody>
                            {log.parsing?.strategyLog?.map((s: any, i: number) => (
                              <tr key={i} className={`border-b border-[#1a1a1a]/50 ${s.matched ? 'bg-green-500/5' : ''}`}>
                                <td className="px-3 py-1.5">
                                  <span className={s.matched ? 'text-green-400 font-bold' : 'text-gray-400'}>{s.strategy}</span>
                                </td>
                                <td className="px-3 py-1.5">
                                  {s.matched ? <span className="text-green-400">✓ YES</span> : <span className="text-gray-600">—</span>}
                                </td>
                                <td className="px-3 py-1.5 text-gray-400 font-mono max-w-xs truncate">{s.rawMatch}</td>
                                <td className="px-3 py-1.5 text-gray-300 font-mono">{s.parsedValue || '—'}</td>
                                <td className="px-3 py-1.5 text-gray-500">{s.notes}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    
                    {/* Result */}
                    <div>
                      <h4 className="text-[10px] font-bold text-orange-400 tracking-wider mb-2">RESULT</h4>
                      <div className="bg-[#0a0a0a] rounded border border-[#1a1a1a] p-3 text-[10px] font-mono space-y-1">
                        <div>
                          <span className="text-gray-500">Price:</span>{' '}
                          <span className={hasPrice ? 'text-green-400 font-bold' : 'text-yellow-400'}>
                            {log.result?.priceDisplay || 'N/A'}
                          </span>
                          {' | '}
                          <span className="text-gray-500">Currency:</span> <span className="text-gray-300">{log.parsing?.currency}</span>
                          {' | '}
                          <span className="text-gray-500">Strategy:</span> <span className="text-gray-300">{log.parsing?.strategy}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Raw Price Text:</span> <span className="text-gray-300">{log.parsing?.rawPriceText}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Offers Count:</span> <span className="text-gray-300">{log.parsing?.aodOfferCount}</span>
                          {' | '}
                          <span className="text-gray-500">a-Price Count:</span> <span className="text-gray-300">{log.parsing?.aPriceCount}</span>
                        </div>
                      </div>
                    </div>
                    
                    {/* HTML Snippet */}
                    {log.content?.htmlSnippet && (
                      <div>
                        <h4 className="text-[10px] font-bold text-orange-400 tracking-wider mb-2">HTML SNIPPET (first 2000 chars)</h4>
                        <pre className="bg-[#0a0a0a] rounded border border-[#1a1a1a] p-3 text-[9px] text-gray-500 max-h-48 overflow-auto whitespace-pre-wrap font-mono">
                          {log.content.htmlSnippet}
                        </pre>
                      </div>
                    )}
                    
                    {/* Markdown Snippet */}
                    {log.content?.markdownSnippet && (
                      <div>
                        <h4 className="text-[10px] font-bold text-orange-400 tracking-wider mb-2">MARKDOWN SNIPPET (first 1000 chars)</h4>
                        <pre className="bg-[#0a0a0a] rounded border border-[#1a1a1a] p-3 text-[9px] text-gray-500 max-h-48 overflow-auto whitespace-pre-wrap font-mono">
                          {log.content.markdownSnippet}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
      </div>
    )}
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
            <span className="text-gray-700">SupplierCrawl v1.1 — Bulk AOD Scanner + Debug Logs</span>
          </div>
        </footer>
      </main>
    </div>
  )
}
