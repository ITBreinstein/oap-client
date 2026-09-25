import { describe, expect, it } from "vitest";
import { parseEndpoints, RelayContractError } from "../../src/relay/contract.js";

const base = {
  key: "zoo",
  baseUrl: "http://localhost:5090/ogc-api",
  executeRoute: "relay",
  callbacks: false,
};

describe("parseEndpoints", () => {
  it("reads an endpoint from a relay older than the read route as direct-only, listing everything", () => {
    expect(parseEndpoints({ endpoints: [base] })).toEqual([{ ...base, readRoute: "direct" }]);
  });

  it("reads the read route and the configured process list", () => {
    const [endpoint] = parseEndpoints({
      endpoints: [{ ...base, readRoute: "relay", processes: ["hellojs", "Buffer"] }],
    });
    expect(endpoint).toEqual({ ...base, readRoute: "relay", processes: ["hellojs", "Buffer"] });
  });

  it.each([
    ["an unknown read route", { ...base, readRoute: "proxy" }],
    ["a process list that is not an array", { ...base, processes: "hellojs" }],
    ["a process id that is not a string", { ...base, processes: ["hellojs", 7] }],
  ])("refuses %s", (_, entry) => {
    expect(() => parseEndpoints({ endpoints: [entry] })).toThrow(RelayContractError);
  });
});
