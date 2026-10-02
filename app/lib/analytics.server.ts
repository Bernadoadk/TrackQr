import prisma from "../db.server";
import { Prisma, type DeviceType, type MissedScanReason, type QrType } from "@prisma/client";
import { applyHistoryLimit, type PlanEntitlements } from "./plan.server";

export type PeriodKey = "7d" | "14d" | "30d" | "90d";

const PERIOD_DAYS: Record<PeriodKey, number> = { "7d": 7, "14d": 14, "30d": 30, "90d": 90 };
type AnalyticsAccess = Pick<PlanEntitlements, "earliestScanDate" | "attribution">;

const DEFAULT_ACCESS: AnalyticsAccess = {
  earliestScanDate: null,
  attribution: true,
};

export function parsePeriod(value: string | null | undefined, fallback: PeriodKey = "14d"): PeriodKey {
  return value && value in PERIOD_DAYS ? (value as PeriodKey) : fallback;
}

export function periodRange(period: PeriodKey): { from: Date; to: Date; days: number } {
  const days = PERIOD_DAYS[period] ?? 14;
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  return { from, to, days };
}

export function limitedPeriodRange(period: PeriodKey, access: Partial<AnalyticsAccess> = {}): { from: Date; to: Date; days: number } {
  const base = periodRange(period);
  const from = applyHistoryLimit(base.from, access.earliestScanDate ?? null);
  const days = Math.max(1, Math.ceil((base.to.getTime() - from.getTime()) / 86400000));
  return { ...base, from, days };
}

export interface KpiSnapshot {
  totalScans: number;
  totalConversions: number;
  uniqueVisitors: number;
  convRate: number; // percent
  /** Attributed revenue in cents (shop currency). */
  revenue: number;
  /** Average order value in cents. */
  aov: number;
}

export async function getKpis(shopId: string, period: PeriodKey, accessInput: Partial<AnalyticsAccess> = {}): Promise<KpiSnapshot> {
  const access = { ...DEFAULT_ACCESS, ...accessInput };
  const { from } = limitedPeriodRange(period, access);

  const [scanCount, conv, uniq] = await Promise.all([
    prisma.scan.count({ where: { qrCode: { shopId }, createdAt: { gte: from } } }),
    access.attribution
      ? prisma.conversion.aggregate({
          where: { scan: { qrCode: { shopId }, createdAt: { gte: from } } },
          _count: { _all: true },
          _sum: { amount: true },
        })
      : Promise.resolve(null),
    prisma.scan.groupBy({
      by: ["sessionToken"],
      where: { qrCode: { shopId }, createdAt: { gte: from }, sessionToken: { not: null } },
    }).then(rows => rows.length),
  ]);

  const convCount = conv?._count._all ?? 0;
  const revenue = conv?._sum.amount ?? 0;
  return {
    totalScans: scanCount,
    totalConversions: convCount,
    uniqueVisitors: uniq,
    convRate: scanCount > 0 ? (convCount / scanCount) * 100 : 0,
    revenue,
    aov: convCount > 0 ? Math.round(revenue / convCount) : 0,
  };
}

export interface SeriesPoint { date: string; scans: number; conversions: number; revenue: number; }

export async function getDailySeries(shopId: string, period: PeriodKey, accessInput: Partial<AnalyticsAccess> = {}): Promise<SeriesPoint[]> {
  const access = { ...DEFAULT_ACCESS, ...accessInput };
  const { from, days } = limitedPeriodRange(period, access);
  // Initialize the empty buckets so zero-traffic days still appear.
  const buckets = new Map<string, SeriesPoint>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, { date: key, scans: 0, conversions: 0, revenue: 0 });
  }

  type Row = { day: Date; scans: bigint; conversions: bigint; revenue: bigint };
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT
      date_trunc('day', s."createdAt")::date AS day,
      COUNT(DISTINCT s."id")::bigint          AS scans,
      ${access.attribution ? Prisma.sql`COUNT(c."id")::bigint` : Prisma.sql`0::bigint`} AS conversions,
      ${access.attribution ? Prisma.sql`COALESCE(SUM(c."amount"), 0)::bigint` : Prisma.sql`0::bigint`} AS revenue
    FROM "Scan" s
    JOIN "QrCode" q ON q."id" = s."qrCodeId"
    LEFT JOIN "Conversion" c ON c."scanId" = s."id"
    WHERE q."shopId" = ${shopId} AND s."createdAt" >= ${from}
    GROUP BY day
    ORDER BY day ASC
  `);

  for (const r of rows) {
    const key = new Date(r.day).toISOString().slice(0, 10);
    buckets.set(key, {
      date: key,
      scans: Number(r.scans),
      conversions: Number(r.conversions),
      revenue: Number(r.revenue),
    });
  }
  return Array.from(buckets.values());
}

export interface DeviceBreakdown { device: DeviceType; scans: number; pct: number; }

export async function getDeviceBreakdown(shopId: string, period: PeriodKey, access: Partial<AnalyticsAccess> = {}): Promise<DeviceBreakdown[]> {
  const { from } = limitedPeriodRange(period, access);
  const rows = await prisma.scan.groupBy({
    by: ["device"],
    where: { qrCode: { shopId }, createdAt: { gte: from } },
    _count: { _all: true },
  });
  const total = rows.reduce((s, r) => s + r._count._all, 0) || 1;
  return rows
    .map(r => ({ device: r.device, scans: r._count._all, pct: (r._count._all / total) * 100 }))
    .sort((a, b) => b.scans - a.scans);
}

export interface CountryBreakdown { country: string; scans: number; pct: number; }

export async function getCountryBreakdown(shopId: string, period: PeriodKey, limit = 8, access: Partial<AnalyticsAccess> = {}): Promise<CountryBreakdown[]> {
  const { from } = limitedPeriodRange(period, access);
  const rows = await prisma.scan.groupBy({
    by: ["country"],
    where: { qrCode: { shopId }, createdAt: { gte: from }, country: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { country: "desc" } },
    take: limit,
  });
  const total = rows.reduce((s, r) => s + r._count._all, 0) || 1;
  return rows.map(r => ({
    country: r.country ?? "??",
    scans: r._count._all,
    pct: (r._count._all / total) * 100,
  }));
}

export interface TopQr { id: string; name: string; type: QrType; scans: number; conversions: number; revenue: number; rate: number; }

export async function getTopQrCodes(shopId: string, period: PeriodKey, limit = 5, accessInput: Partial<AnalyticsAccess> = {}): Promise<TopQr[]> {
  const access = { ...DEFAULT_ACCESS, ...accessInput };
  const { from } = limitedPeriodRange(period, access);
  type Row = { id: string; name: string; type: QrType; scans: bigint; conversions: bigint; revenue: bigint };
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT
      q."id"                          AS id,
      q."name"                        AS name,
      q."type"                        AS type,
      COUNT(DISTINCT s."id")::bigint  AS scans,
      ${access.attribution ? Prisma.sql`COUNT(c."id")::bigint` : Prisma.sql`0::bigint`} AS conversions,
      ${access.attribution ? Prisma.sql`COALESCE(SUM(c."amount"), 0)::bigint` : Prisma.sql`0::bigint`} AS revenue
    FROM "QrCode" q
    LEFT JOIN "Scan" s ON s."qrCodeId" = q."id" AND s."createdAt" >= ${from}
    LEFT JOIN "Conversion" c ON c."scanId" = s."id"
    WHERE q."shopId" = ${shopId} AND q."archivedAt" IS NULL
    GROUP BY q."id"
    ORDER BY scans DESC NULLS LAST
    LIMIT ${limit}
  `);
  return rows.map(r => {
    const scans = Number(r.scans);
    const conv = Number(r.conversions);
    return {
      id: r.id, name: r.name, type: r.type,
      scans, conversions: conv, revenue: Number(r.revenue),
      rate: scans > 0 ? (conv / scans) * 100 : 0,
    };
  });
}

export interface RecentScanRow {
  id: string;
  qrName: string;
  country: string | null;
  device: DeviceType;
  createdAt: Date;
  converted: boolean;
  ref: string | null;
}

export async function getRecentScans(shopId: string, limit = 12, accessInput: Partial<AnalyticsAccess> = {}): Promise<RecentScanRow[]> {
  const access = { ...DEFAULT_ACCESS, ...accessInput };
  const rows = await prisma.scan.findMany({
    where: {
      qrCode: { shopId },
      ...(access.earliestScanDate ? { createdAt: { gte: access.earliestScanDate } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true, country: true, device: true, createdAt: true, ref: true,
      qrCode: { select: { name: true } },
      conversions: { select: { id: true }, take: 1 },
    },
  });
  return rows.map(r => ({
    id: r.id,
    qrName: r.qrCode.name,
    country: r.country,
    device: r.device,
    createdAt: r.createdAt,
    converted: !!access.attribution && r.conversions.length > 0,
    ref: r.ref,
  }));
}

export interface ActivityItem {
  id: string;
  kind: "scan" | "conversion" | "create" | "pause" | "lead";
  /** English text (translation key) with {placeholders} filled from `params`. */
  title: string;
  /** Second line: a translation key, or merchant data shown as-is when `whoRaw`. */
  who: string;
  whoRaw: boolean;
  params: Record<string, string>;
  time: Date;
  tone: "green" | "blue" | "violet" | "amber";
}

export async function getActivityFeed(shopId: string, limit = 6, accessInput: Partial<AnalyticsAccess> = {}): Promise<ActivityItem[]> {
  const access = { ...DEFAULT_ACCESS, ...accessInput };
  const since = access.earliestScanDate ? { createdAt: { gte: access.earliestScanDate } } : {};
  const [scans, conversions, creates, leads] = await Promise.all([
    prisma.scan.findMany({
      where: { qrCode: { shopId }, ...since },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, createdAt: true, country: true, qrCode: { select: { name: true } } },
    }),
    access.attribution
      ? prisma.conversion.findMany({
          where: { scan: { qrCode: { shopId }, ...since } },
          orderBy: { attributedAt: "desc" },
          take: limit,
          select: { id: true, attributedAt: true, orderName: true, scan: { select: { qrCode: { select: { name: true } } } } },
        })
      : Promise.resolve([]),
    prisma.qrCode.findMany({
      where: { shopId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, name: true, createdAt: true },
    }),
    prisma.lead.findMany({
      where: { campaign: { shopId }, ...since },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, createdAt: true, campaign: { select: { name: true } } },
    }),
  ]);

  const merged: ActivityItem[] = [
    ...scans.map(s => ({
      id: `scan-${s.id}`,
      kind: "scan" as const,
      title: "{name} scanned",
      who: s.country ? "Customer in {country}" : "Customer",
      whoRaw: false,
      params: { name: s.qrCode.name, country: s.country ?? "" },
      time: s.createdAt,
      tone: "green" as const,
    })),
    ...conversions.map(c => ({
      id: `conv-${c.id}`,
      kind: "conversion" as const,
      title: "New conversion attributed",
      who: `${c.scan.qrCode.name}${c.orderName ? ` · ${c.orderName}` : ""}`,
      whoRaw: true,
      params: {},
      time: c.attributedAt,
      tone: "blue" as const,
    })),
    ...creates.map(q => ({
      id: `qr-${q.id}`,
      kind: "create" as const,
      title: "QR code created",
      who: q.name,
      whoRaw: true,
      params: {},
      time: q.createdAt,
      tone: "violet" as const,
    })),
    ...leads.map(l => ({
      id: `lead-${l.id}`,
      kind: "lead" as const,
      title: "New campaign lead",
      who: l.campaign.name,
      whoRaw: true,
      params: {},
      time: l.createdAt,
      tone: "amber" as const,
    })),
  ];

  return merged.sort((a, b) => b.time.getTime() - a.time.getTime()).slice(0, limit);
}

/* ─────────────────────────────────────────────────────────
   Per-QR / per-campaign aggregates (counted in SQL, never by
   loading every scan row).
   ───────────────────────────────────────────────────────── */

export interface QrStats { scans: number; conversions: number; revenue: number; missed: number; }

export async function getQrStats(shopId: string, ids: string[], accessInput: Partial<AnalyticsAccess> = {}): Promise<Map<string, QrStats>> {
  const access = { ...DEFAULT_ACCESS, ...accessInput };
  const stats = new Map<string, QrStats>();
  if (!ids.length) return stats;
  const since = access.earliestScanDate ?? new Date(0);

  const [scanRows, convRows, missedRows] = await Promise.all([
    prisma.scan.groupBy({
      by: ["qrCodeId"],
      where: { qrCodeId: { in: ids }, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    access.attribution
      ? prisma.$queryRaw<{ qrCodeId: string; conversions: bigint; revenue: bigint }[]>(Prisma.sql`
          SELECT s."qrCodeId" AS "qrCodeId",
                 COUNT(c."id")::bigint AS conversions,
                 COALESCE(SUM(c."amount"), 0)::bigint AS revenue
          FROM "Conversion" c
          JOIN "Scan" s ON s."id" = c."scanId"
          JOIN "QrCode" q ON q."id" = s."qrCodeId"
          WHERE q."shopId" = ${shopId} AND s."qrCodeId" IN (${Prisma.join(ids)}) AND s."createdAt" >= ${since}
          GROUP BY s."qrCodeId"
        `)
      : Promise.resolve([]),
    prisma.missedScan.groupBy({
      by: ["qrCodeId"],
      where: { qrCodeId: { in: ids }, createdAt: { gte: since } },
      _count: { _all: true },
    }),
  ]);

  const get = (id: string) => {
    let s = stats.get(id);
    if (!s) {
      s = { scans: 0, conversions: 0, revenue: 0, missed: 0 };
      stats.set(id, s);
    }
    return s;
  };
  for (const r of scanRows) get(r.qrCodeId).scans = r._count._all;
  for (const r of convRows) {
    const s = get(r.qrCodeId);
    s.conversions = Number(r.conversions);
    s.revenue = Number(r.revenue);
  }
  for (const r of missedRows) get(r.qrCodeId).missed = r._count._all;
  return stats;
}

export interface MissedScanSummary {
  total: number;
  overQuota: number;
  byReason: Partial<Record<MissedScanReason, number>>;
}

export async function getMissedScanSummary(shopId: string, days = 7): Promise<MissedScanSummary> {
  const rows = await prisma.missedScan.groupBy({
    by: ["reason"],
    where: { qrCode: { shopId }, createdAt: { gte: new Date(Date.now() - days * 86400000) } },
    _count: { _all: true },
  });
  const byReason: Partial<Record<MissedScanReason, number>> = {};
  let total = 0;
  for (const r of rows) {
    byReason[r.reason] = r._count._all;
    total += r._count._all;
  }
  return { total, overQuota: byReason.OVER_QUOTA ?? 0, byReason };
}

/** Dashboard one-shot loader payload — used by app._index loader. */
export async function getDashboardData(shopId: string, accessInput: Partial<AnalyticsAccess> = {}) {
  const access = { ...DEFAULT_ACCESS, ...accessInput };
  const [qrCodes, kpis14, series, activity, totals, activeTotal, missed] = await Promise.all([
    prisma.qrCode.findMany({
      where: { shopId, archivedAt: null },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, slug: true, name: true, type: true, active: true, createdAt: true },
    }),
    getKpis(shopId, "14d", access),
    getDailySeries(shopId, "14d", access),
    getActivityFeed(shopId, 6, access),
    prisma.qrCode.count({ where: { shopId, archivedAt: null } }),
    prisma.qrCode.count({ where: { shopId, archivedAt: null, active: true } }),
    getMissedScanSummary(shopId, 7),
  ]);
  const stats = await getQrStats(shopId, qrCodes.map(q => q.id), access);

  return {
    counts: { total: totals, active: activeTotal },
    kpis: kpis14,
    series,
    activity,
    missed,
    recent: qrCodes.map(q => ({
      ...q,
      scans: stats.get(q.id)?.scans ?? 0,
      conversions: access.attribution ? stats.get(q.id)?.conversions ?? 0 : 0,
    })),
  };
}
