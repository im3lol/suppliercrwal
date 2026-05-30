'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Zap, Search, Download, Upload, Trash2, RefreshCw,
  Globe, Clock, Activity, Database, Server, ChevronRight,
  Terminal, Loader2, CheckCircle2, XCircle, AlertTriangle,
  LayoutDashboard, History, Settings, Shield, ArrowUpDown,
  Package, MapPin
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { useToast } from '@/hooks/use-toast'
import Image from 'next/image'

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
  const [crawlProgress, setCrawlProgress] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(false)
  const [currentTime, setCurrentTime] = useState('')
  const [totalScans, setTotalScans] = useState(0)
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

  // ── Crawl Handler ──
  const handleCrawl = async () => {
    const asins = asinInput
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean)

    if (asins.length === 0) {
      toast({ title: 'No ASIN entered', description: 'Enter one or more ASINs to crawl', variant: 'destructive' })
      return
    }

    setIsCrawling(true)
    setCrawlProgress('Initializing crawl...')

    try {
      setCrawlProgress(`Scanning ${asins.length} ASIN(s) across 5 regions...`)
      const res = await fetch('/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asins }),
      })

      const data = await res.json()

      if (data.success) {
        const totalPrices = data.data.reduce(
          (acc: number, r: { results: { price: string }[] }) =>
            acc + r.results.filter((rr: { price: string }) => rr.price !== 'N/A').length,
          0
        )
        setCrawlProgress(`Scan complete — ${totalPrices} prices found`)
        toast({
          title: 'Scan Complete',
          description: `Found ${totalPrices} prices across ${asins.length} product(s)`,
        })
        setAsinInput('')
        fetchProducts()
      } else {
        setCrawlProgress('Scan failed')
        toast({ title: 'Scan Failed', description: data.error, variant: 'destructive' })
      }
    } catch (e) {
      setCrawlProgress('Scan failed — network error')
      toast({ title: 'Network Error', description: String(e), variant: 'destructive' })
    } finally {
      setIsCrawling(false)
    }
  }

  // ── Delete Handler ──
  const handleDelete = async () => {
    if (selectedIds.size === 0) {
      toast({ title: 'No items selected', variant: 'destructive' })
      return
    }

    try {
      await fetch('/api/products', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      })
      setSelectedIds(new Set())
      fetchProducts()
      toast({ title: 'Deleted', description: `${selectedIds.size} product(s) deleted` })
    } catch (e) {
      toast({ title: 'Delete failed', variant: 'destructive' })
    }
  }

  // ── Export Handler ──
  const handleExport = () => {
    window.open('/api/export', '_blank')
  }

  // ── Select All ──
  const toggleSelectAll = () => {
    if (selectedIds.size === products.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(products.map((p) => p.id)))
    }
  }

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  const onlineRegions = 5
  const priceRows = products.reduce(
    (acc, p) => acc + Object.values(p.prices).filter((pr) => pr.price !== 'N/A').length,
    0
  )

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // RENDER
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  return (
    <div className="min-h-screen flex bg-[#0a0a0a] text-gray-100 font-mono">
      {/* ── SIDEBAR ── */}
      <aside className="w-56 bg-[#0f0f0f] border-r border-[#1a1a1a] flex flex-col shrink-0">
        {/* Logo */}
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

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1">
          <div className="text-[10px] text-gray-600 uppercase tracking-widest mb-2 px-2">
            Navigation
          </div>
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

          <div className="text-[10px] text-gray-600 uppercase tracking-widest mt-4 mb-2 px-2">
            System
          </div>
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

        {/* Bottom */}
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

          {/* Status Bar */}
          <div className="flex items-center gap-6 mt-2 text-[10px]">
            <span className="text-gray-500">
              TERMINAL STATUS:{' '}
              <span className="text-green-400">Online</span>
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
          {/* ── CRAWL COMMAND ── */}
          <section className="bg-[#111111] rounded-lg border border-[#1a1a1a] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a1a1a]">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-orange-400" />
                <h2 className="text-xs font-bold tracking-wider">CRAWL COMMAND (BULK)</h2>
              </div>
              {crawlProgress && (
                <div className="flex items-center gap-1.5 text-[10px]">
                  {isCrawling ? (
                    <Loader2 className="w-3 h-3 text-yellow-400 animate-spin" />
                  ) : crawlProgress.includes('complete') ? (
                    <CheckCircle2 className="w-3 h-3 text-green-400" />
                  ) : crawlProgress.includes('failed') ? (
                    <XCircle className="w-3 h-3 text-red-400" />
                  ) : null}
                  <span
                    className={
                      isCrawling
                        ? 'text-yellow-400'
                        : crawlProgress.includes('complete')
                          ? 'text-green-400'
                          : crawlProgress.includes('failed')
                            ? 'text-red-400'
                            : 'text-gray-400'
                    }
                  >
                    {crawlProgress.toUpperCase()}
                  </span>
                </div>
              )}
            </div>
            <div className="p-4 flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-600" />
                <Input
                  value={asinInput}
                  onChange={(e) => setAsinInput(e.target.value)}
                  placeholder="B08LKLQP2N (comma or newline separated)"
                  className="bg-[#0a0a0a] border-[#2a2a2a] text-gray-200 placeholder-gray-600 text-xs h-9 pl-9 font-mono focus:border-orange-500/50 focus:ring-orange-500/20"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) handleCrawl()
                  }}
                />
              </div>
              <Button
                onClick={handleCrawl}
                disabled={isCrawling}
                className="bg-orange-500 hover:bg-orange-600 text-black font-bold text-xs h-9 px-5 shrink-0"
              >
                {isCrawling ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                ) : (
                  <Zap className="w-3.5 h-3.5 mr-1.5" />
                )}
                EXECUTE BULK SCAN
              </Button>
            </div>
          </section>

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
                onClick={handleExport}
              >
                <Download className="w-3 h-3 mr-1.5" />
                EXPORT CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="bg-transparent border-[#2a2a2a] text-gray-400 hover:text-gray-200 hover:border-[#3a3a3a] text-[10px] h-7"
                onClick={handleDelete}
                disabled={selectedIds.size === 0}
              >
                <Trash2 className="w-3 h-3 mr-1.5" />
                DELETE SELECTED
                {selectedIds.size > 0 && (
                  <span className="ml-1 bg-orange-500/20 text-orange-400 px-1 rounded text-[9px]">
                    {selectedIds.size}
                  </span>
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

          {/* ── RESULTS TABLE ── */}
          <section className="bg-[#111111] rounded-lg border border-[#1a1a1a] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a1a1a]">
              <div className="flex items-center gap-2">
                <div className="w-1 h-4 bg-orange-500 rounded-full" />
                <h2 className="text-xs font-bold tracking-wider">
                  {viewMode === 'live' ? 'LIVE SESSION RESULTS' : 'HISTORICAL DATA ARCHIVE'}
                </h2>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-gray-500">
                <span>{products.length} scans</span>
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
                <span className="text-[10px] text-gray-700 mt-1">
                  Enter an ASIN above and execute a bulk scan
                </span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-[#1a1a1a] text-gray-500">
                      <th className="text-left px-3 py-2.5 w-8">
                        <Checkbox
                          checked={selectedIds.size === products.length && products.length > 0}
                          onCheckedChange={toggleSelectAll}
                          className="border-[#3a3a3a] data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500"
                        />
                      </th>
                      <th className="text-left px-3 py-2.5">IMAGE</th>
                      <th className="text-left px-3 py-2.5">ASIN</th>
                      <th className="text-left px-3 py-2.5 min-w-[200px]">PRODUCT NAME</th>
                      {REGIONS.map((r) => (
                        <th key={r.key} className="text-left px-3 py-2.5">
                          <span className="flex items-center gap-1">
                            <span>{r.flag}</span>
                            <span>{r.short}</span>
                          </span>
                        </th>
                      ))}
                      <th className="text-left px-3 py-2.5">LAST SCAN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((product) => (
                      <tr
                        key={product.id}
                        className="border-b border-[#1a1a1a]/50 hover:bg-[#1a1a1a]/30 transition-colors"
                      >
                        <td className="px-3 py-2.5">
                          <Checkbox
                            checked={selectedIds.has(product.id)}
                            onCheckedChange={() => toggleSelect(product.id)}
                            className="border-[#3a3a3a] data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500"
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          {product.image ? (
                            <div className="w-10 h-10 rounded bg-[#1a1a1a] overflow-hidden">
                              <img
                                src={product.image}
                                alt={product.name}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  ;(e.target as HTMLImageElement).style.display = 'none'
                                }}
                              />
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
                        <td className="px-3 py-2.5 text-gray-300 max-w-[300px] truncate">
                          {product.name}
                        </td>
                        {REGIONS.map((r) => {
                          const priceInfo = product.prices[r.key]
                          const hasPrice = priceInfo && priceInfo.price !== 'N/A'
                          const domain = priceInfo?.domain || `amazon.${r.key === 'COM' ? 'com' : r.key.toLowerCase()}`
                          const productUrl = `https://www.${domain}/dp/${product.asin}/`
                          return (
                            <td key={r.key} className="px-3 py-2.5">
                              {hasPrice ? (
                                <a
                                  href={productUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-green-400 font-mono hover:text-green-300 hover:underline underline-offset-2 transition-colors cursor-pointer"
                                  title={`Open on ${domain}`}
                                >
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
        </div>

        {/* ── FOOTER ── */}
        <footer className="bg-[#0f0f0f] border-t border-[#1a1a1a] px-4 py-2 mt-auto">
          <div className="flex items-center justify-between text-[10px] text-gray-600">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <Server className="w-3 h-3" />
                AOD-ONLY ENGINE
              </span>
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                5 REGIONS
              </span>
              <span className="flex items-center gap-1">
                <Globe className="w-3 h-3" />
                COM • EG • DE • SA • AE
              </span>
            </div>
            <span className="text-gray-700">SupplierCrawl v1.0 — All prices via AOD buybox only</span>
          </div>
        </footer>
      </main>
    </div>
  )
}
