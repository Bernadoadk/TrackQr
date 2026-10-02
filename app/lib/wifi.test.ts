import { describe, expect, it } from "vitest";
import { parseWifiPayload, wifiPayload } from "./wifi";

describe("wifi payloads", () => {
  it("escapes special characters", () => {
    expect(wifiPayload("Guest;net", "p:a\\ss", "WPA")).toBe("WIFI:T:WPA;S:Guest\\;net;P:p\\:a\\\\ss;;");
    expect(wifiPayload("Lobby", "ignored", "nopass", true)).toBe("WIFI:T:nopass;S:Lobby;P:;H:true;;");
  });

  it("round-trips through the parser", () => {
    const ssid = "Café \"Aurora\", 2F";
    const password = "a;b:c\\d,e";
    expect(parseWifiPayload(wifiPayload(ssid, password, "WEP"))).toEqual({ ssid, password, encryption: "WEP" });
  });

  it("falls back to WPA for unknown encryption", () => {
    expect(parseWifiPayload("WIFI:S:Home;T:WPA3;P:x;;").encryption).toBe("WPA");
  });
});
