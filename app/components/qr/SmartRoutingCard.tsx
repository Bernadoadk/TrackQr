import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Field, Input, Select } from "../ui/Input";
import { FeatureLock } from "../ui/FeatureLock";
import { Icon } from "../ui/Icon";
import { RangeSlider } from "../ui/RangeSlider";
import {
  MAX_ROUTING_RULES,
  type DeviceTarget,
  type RoutingCondition,
  type RoutingConfig,
  type RoutingRule,
} from "../../lib/routing";
import { t } from "../../lib/i18n";

type ConditionType = RoutingCondition["type"];

const CONDITION_LABELS: Record<ConditionType, string> = {
  device: "Device",
  country: "Country",
  language: "Language",
  schedule: "Day & time",
};

const DEVICE_OPTIONS: { value: DeviceTarget; label: string }[] = [
  { value: "ios", label: "iPhone / iPad" },
  { value: "android", label: "Android" },
  { value: "mobile", label: "Any mobile" },
  { value: "desktop", label: "Desktop" },
];

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function defaultCondition(type: ConditionType, timezone: string): RoutingCondition {
  switch (type) {
    case "device": return { type: "device", devices: ["ios"] };
    case "country": return { type: "country", countries: [] };
    case "language": return { type: "language", languages: [] };
    case "schedule": return { type: "schedule", days: [1, 2, 3, 4, 5], from: "09:00", to: "18:00", timezone };
  }
}

function listToText(values: string[]) {
  return values.join(", ");
}

function textToList(text: string, transform: (s: string) => string) {
  return text.split(/[\s,;]+/).map(s => transform(s.trim())).filter(Boolean);
}

interface SmartRoutingCardProps {
  value: RoutingConfig;
  onChange: (next: RoutingConfig) => void;
  locked: boolean;
  timezone: string;
}

/**
 * Smart routing (Growth): per-rule redirects by device, country, language or
 * day/time, plus an A/B split of the default destination. Rules are checked
 * top to bottom; the first match wins.
 */
export function SmartRoutingCard({ value, onChange, locked, timezone }: SmartRoutingCardProps) {
  const updateRule = (index: number, patch: Partial<RoutingRule>) => {
    const rules = value.rules.map((r, i) => (i === index ? { ...r, ...patch } : r));
    onChange({ ...value, rules });
  };
  const updateCondition = (index: number, condition: RoutingCondition) => updateRule(index, { conditions: [condition] });
  const addRule = () => {
    const id = `r${Date.now().toString(36)}`;
    onChange({ ...value, rules: [...value.rules, { id, label: "", conditions: [defaultCondition("device", timezone)], url: "" }] });
  };
  const removeRule = (index: number) => onChange({ ...value, rules: value.rules.filter((_, i) => i !== index) });
  const moveRule = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= value.rules.length) return;
    const rules = [...value.rules];
    [rules[index], rules[target]] = [rules[target], rules[index]];
    onChange({ ...value, rules });
  };

  return (
    <Card className="card-pad-lg">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div className="section-h" style={{ fontSize: 15, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}>
            {t("Smart routing")} <Badge tone="violet">{t("Growth")}</Badge>
          </div>
          <div className="section-sub">
            {t("Send scans to another page by device, country, language or time — or split traffic to A/B test two destinations. One printed code, the right page for everyone.")}
          </div>
        </div>
      </div>

      {locked ? (
        <div className="mt-4">
          <FeatureLock
            compact
            title={t("Smart routing & A/B tests")}
            desc={t("iPhone users to the App Store, Android to Google Play, French visitors to your French page, weekend scans to a promo — without reprinting.")}
            plan="Growth"
          />
        </div>
      ) : (
        <div className="col gap-3 mt-4">
          {value.rules.length === 0 && (
            <div className="routing-empty">
              <Icon name="layers" size={15} />
              <span>{t("No rules yet — every scan goes to the destination above.")}</span>
            </div>
          )}

          {value.rules.map((rule, index) => {
            const condition = rule.conditions[0] ?? defaultCondition("device", timezone);
            return (
              <div key={rule.id} className="routing-rule">
                <div className="routing-rule-head">
                  <span className="routing-rule-index">{index + 1}</span>
                  <span className="routing-rule-if">{t("If")}</span>
                  <Select
                    value={condition.type}
                    onChange={e => updateCondition(index, defaultCondition(e.target.value as ConditionType, timezone))}
                    aria-label={t("Condition")}
                    style={{ maxWidth: 160 }}
                  >
                    {(Object.keys(CONDITION_LABELS) as ConditionType[]).map(item => (
                      <option key={item} value={item}>{t(CONDITION_LABELS[item])}</option>
                    ))}
                  </Select>
                  <div className="routing-rule-actions">
                    <button type="button" className="routing-icon-btn" onClick={() => moveRule(index, -1)} disabled={index === 0} aria-label={t("Move rule up")} title={t("Move up")}>
                      <Icon name="chevron-up" size={13} />
                    </button>
                    <button type="button" className="routing-icon-btn" onClick={() => moveRule(index, 1)} disabled={index === value.rules.length - 1} aria-label={t("Move rule down")} title={t("Move down")}>
                      <Icon name="chevron-down" size={13} />
                    </button>
                    <button type="button" className="routing-icon-btn danger" onClick={() => removeRule(index)} aria-label={t("Remove rule")} title={t("Remove rule")}>
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                </div>

                <div className="routing-rule-body">
                  {condition.type === "device" && (
                    <div className="routing-chips" role="group" aria-label={t("Devices")}>
                      {DEVICE_OPTIONS.map(d => {
                        const on = condition.devices.includes(d.value);
                        return (
                          <button
                            key={d.value}
                            type="button"
                            className={`routing-chip ${on ? "active" : ""}`}
                            aria-pressed={on}
                            onClick={() => updateCondition(index, {
                              type: "device",
                              devices: on ? condition.devices.filter(v => v !== d.value) : [...condition.devices, d.value],
                            })}
                          >
                            {t(d.label)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {condition.type === "country" && (
                    <Field key={`${rule.id}-country`} hint={t("Two-letter country codes, e.g. FR, BE, CH.")}>
                      <Input
                        placeholder={t("FR, BE, CH")}
                        defaultValue={listToText(condition.countries)}
                        onBlur={e => updateCondition(index, { type: "country", countries: textToList(e.target.value, s => s.toUpperCase()) })}
                      />
                    </Field>
                  )}
                  {condition.type === "language" && (
                    <Field key={`${rule.id}-language`} hint={t("Visitor browser language, two letters, e.g. fr, es.")}>
                      <Input
                        placeholder={t("fr, es")}
                        defaultValue={listToText(condition.languages)}
                        onBlur={e => updateCondition(index, { type: "language", languages: textToList(e.target.value, s => s.toLowerCase().slice(0, 2)) })}
                      />
                    </Field>
                  )}
                  {condition.type === "schedule" && (
                    <div className="col gap-2">
                      <div className="routing-chips" role="group" aria-label={t("Days")}>
                        {DAYS.map((label, day) => {
                          const on = condition.days.includes(day);
                          return (
                            <button
                              key={label}
                              type="button"
                              className={`routing-chip ${on ? "active" : ""}`}
                              aria-pressed={on}
                              onClick={() => updateCondition(index, {
                                ...condition,
                                days: on ? condition.days.filter(d => d !== day) : [...condition.days, day],
                              })}
                            >
                              {t(label)}
                            </button>
                          );
                        })}
                      </div>
                      <div className="routing-time">
                        <span>{t("from")}</span>
                        <input className="input" type="time" value={condition.from} onChange={e => updateCondition(index, { ...condition, from: e.target.value })} aria-label={t("From")} />
                        <span>{t("to")}</span>
                        <input className="input" type="time" value={condition.to} onChange={e => updateCondition(index, { ...condition, to: e.target.value })} aria-label={t("To")} />
                        <span className="routing-tz">{condition.timezone}</span>
                      </div>
                    </div>
                  )}
                </div>

                <Field label={t("Send to")} className="mt-2">
                  <Input
                    icon="link"
                    placeholder="https://apps.apple.com/app/…"
                    value={rule.url}
                    onChange={e => updateRule(index, { url: e.target.value })}
                  />
                </Field>
              </div>
            );
          })}

          <div>
            <Button size="sm" variant="secondary" icon="plus" onClick={addRule} disabled={value.rules.length >= MAX_ROUTING_RULES}>
              {t("Add a rule")}
            </Button>
          </div>

          <div className="advanced-divider" />

          <div className="routing-ab">
            <label className="toggle">
              <input
                type="checkbox"
                aria-label={t("A/B test")}
                checked={!!value.abTest}
                onChange={e => onChange({ ...value, abTest: e.target.checked ? { url: "", share: 50 } : null })}
              />
              <span className="toggle-track"><span className="toggle-thumb" /></span>
            </label>
            <div style={{ flex: 1 }}>
              <div className="strong" style={{ fontSize: 13 }}>{t("A/B test")}</div>
              <div className="text-xs muted">{t("Split visitors between the destination above (A) and another page (B). Each visitor keeps the same variant.")}</div>
            </div>
          </div>
          {value.abTest && (
            <div className="grid grid-2">
              <Field label={t("Variant B URL")}>
                <Input
                  icon="link"
                  placeholder="https://your-store.com/pages/new-landing"
                  value={value.abTest.url}
                  onChange={e => onChange({ ...value, abTest: { ...value.abTest!, url: e.target.value } })}
                />
              </Field>
              <Field label={t("Visitors sent to B · {share}%", { share: value.abTest.share })}>
                <RangeSlider
                  min={5}
                  max={95}
                  step={5}
                  value={value.abTest.share}
                  onChange={share => onChange({ ...value, abTest: { ...value.abTest!, share } })}
                  aria-label={t("Share of visitors sent to variant B")}
                />
              </Field>
            </div>
          )}

          <div className="text-xs muted">
            {t("Rules are checked from top to bottom — the first match wins. Scans that match no rule follow the A/B test, then the destination above. Results appear per route in the scans export.")}
          </div>
        </div>
      )}
    </Card>
  );
}
