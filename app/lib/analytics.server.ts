import prisma from "../db.server";
import { Prisma, type DeviceType, type QrType } from "@prisma/client";
import { applyHistoryLimit, type PlanEntitlements } from "./plan.server";

export type PeriodKey = "7d" | "14d" | "30d" | "90d";

const PERIOD_DAYS: Record<PeriodKey, number> = { "7d": 7, "14d": 14, "30d": 30, "90d": 90 };
type AnalyticsAccess = Pick<PlanEntitlements, "earliestScanDate" | "attribution">;

const DEFAULT_ACCESS: AnalyticsAccess = {
  earliestScanDate: null,
  attribution: true,
};

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
}

export async function getKpis(shopId: string, period: PeriodKey, accessInput: Partial<AnalyticsAccess> = {}): Promise<KpiSnapshot> {
  const access = { ...DEFAULT_ACCESS, ...accessInput };
  const { from } = limitedPeriodRange(period, access);

  const [scanCount, convCount, uniq] = await Promise.all([
    prisma.scan.count({ where: { qrCode: { shopId }, createdAt: { gte: from } } }),
    access.attribution
      ? prisma.conversion.count({ where: { scan: { qrCode: { shopId }, createdAt: { gte: from } } } })
      : Promise.resolve(0),
    prisma.scan.groupBy({
      by: ["sessionToken"],
      where: { qrCode: { shopId }, createdAt: { gte: from }, sessionToken: { not: null } },
    }).then(rows => rows.length),
  ]);

  return {
    totalScans: scanCount,
    totalConversions: convCount,
    uniqueVisitors: uniq,
    convRate: scanCount > 0 ? (convCount / scanCount) * 100 : 0,
  };
}

export interface SeriesPoint { date: string; scans: number; conversions: number; }

export async function getDailySeries(shopId: string, period: PeriodKey, accessInput: Partial<AnalyticsAccess> = {}): Promise<SeriesPoint[]> {
  const access = { ...DEFAULT_ACCESS, ...accessInput };
  const { from, days } = limitedPeriodRange(period, access);
  // Initialize the empty buckets so zero-traffic days still appear.
  const buckets = new Map<string, SeriesPoint>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, { date: key, scans: 0, conversions: 0 });
  }

  type Row = { day: Date; scans: bigint; conversions: bigint };
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT
      date_trunc('day', s."createdAt")::date AS day,
      COUNT(*)::bigint                       AS scans,
      ${access.attribution ? Prisma.sql`COUNT(c."id")::bigint` : Prisma.sql`0::bigint`} AS conversions
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

export interface TopQr { id: string; name: string; type: QrType; scans: number; conversions: number; rate: number; }

export async function getTopQrCodes(shopId: string, period: PeriodKey, limit = 5, accessInput: Partial<AnalyticsAccess> = {}): Promise<TopQr[]> {
  const access = { ...DEFAULT_ACCESS, ...accessInput };
  const { from } = limitedPeriodRange(period, access);
  type Row = { id: string; name: string; type: QrType; scans: bigint; conversions: bigint };
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT
      q."id"                AS id,
      q."name"              AS name,
      q."type"              AS type,
      COUNT(s."id")::bigint AS scans,
      ${access.attribution ? Prisma.sql`COUNT(c."id")::bigint` : Prisma.sql`0::bigint`} AS conversions
    FROM "QrCode" q
    LEFT JOIN "Scan" s ON s."qrCodeId" = q."id" AND s."createdAt" >= ${from}
    LEFT JOIN "Conversion" c ON c."scanId" = s."id"
    WHERE q."shopId" = ${shopId}
    GROUP BY q."id"
    ORDER BY scans DESC NULLS LAST
    LIMIT ${limit}
  `);
  return rows.map(r => {
    const scans = Number(r.scans);
    const conv = Number(r.conversions);
    return {
      id: r.id, name: r.name, type: r.type,
      scans, conversions: conv,
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
      id: true, country: true, device: true, createdAt: true,
      qrCode: { select: { name: true } },
      conversion: { select: { id: true } },
    },
  });
  return rows.map(r => ({
    id: r.id,
    qrName: r.qrCode.name,
    country: r.country,
    device: r.device,
    createdAt: r.createdAt,
      converted: access.attribution && !!r.conversion,
  }));
}

export interface ActivityItem {
  id: string;
  kind: "scan" | "conversion" | "create" | "pause";
  title: string;
  who: string;
  time: Date;
  tone: "green" | "blue" | "violet" | "amber";
}

export async function getActivityFeed(shopId: string, limit = 6, accessInput: Partial<AnalyticsAccess> = {}): Promise<ActivityItem[]> {
  const access = { ...DEFAULT_ACCESS, ...accessInput };
  const [scans, conversions, creates] = await Promise.all([
    prisma.scan.findMany({
      where: {
        qrCode: { shopId },
        ...(access.earliestScanDate ? { createdAt: { gte: access.earliestScanDate } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, createdAt: true, country: true, qrCode: { select: { name: true } } },
    }),
    access.attribution
      ? prisma.conversion.findMany({
          where: {
            scan: {
              qrCode: { shopId },
              ...(access.earliestScanDate ? { createdAt: { gte: access.earliestScanDate } } : {}),
            },
          },
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
  ]);

  const merged: ActivityItem[] = [
    ...scans.map(s => ({
      id: `scan-${s.id}`,
      kind: "scan" as const,
      title: `${s.qrCode.name} scanned`,
      who: s.country ? `Customer in ${s.country}` : "Customer",
      time: s.createdAt,
      tone: "green" as const,
    })),
    ...conversions.map(c => ({
      id: `conv-${c.id}`,
      kind: "conversion" as const,
      title: "New conversion attributed",
      who: `${c.scan.qrCode.name}${c.orderName ? ` · ${c.orderName}` : ""}`,
      time: c.attributedAt,
      tone: "blue" as const,
    })),
    ...creates.map(q => ({
      id: `qr-${q.id}`,
      kind: "create" as const,
      title: "QR code created",
      who: q.name,
      time: q.createdAt,
      tone: "violet" as const,
    })),
  ];

  return merged.sort((a, b) => b.time.getTime() - a.time.getTime()).slice(0, limit);
}

/** Dashboard one-shot loader payload — used by app._index loader. */
export async function getDashboardData(shopId: string, accessInput: Partial<AnalyticsAccess> = {}) {
  const access = { ...DEFAULT_ACCESS, ...accessInput };
  const [qrCodes, kpis14, series, activity] = await Promise.all([
    prisma.qrCode.findMany({
      where: { shopId, archivedAt: null },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: {
        scans:  {
          where: access.earliestScanDate ? { createdAt: { gte: access.earliestScanDate } } : undefined,
          select: { id: true, conversion: { select: { id: true } } },
        },
      },
    }),
    getKpis(shopId, "14d", access),
    getDailySeries(shopId, "14d", access),
    getActivityFeed(shopId, 6, access),
  ]);

  const totals = await prisma.qrCode.aggregate({
    where: { shopId, archivedAt: null },
    _count: { _all: true },
  });

  return {
    counts: { total: totals._count._all },
    kpis: kpis14,
    series,
    activity,
    recent: qrCodes.map(q => ({
      id: q.id, slug: q.slug, name: q.name, type: q.type,
      active: q.active, createdAt: q.createdAt,
      scans: q.scans.length,
      conversions: access.attribution ? q.scans.filter(s => s.conversion).length : 0,
    })),
  };
}
