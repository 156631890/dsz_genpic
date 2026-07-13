// @vitest-environment node

import { afterEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listen: vi.fn((
    _port: number,
    hostOrCallback: string | (() => void),
    callback?: () => void
  ) => {
    (typeof hostOrCallback === "function" ? hostOrCallback : callback)?.();
  })
}));

vi.mock("../../server/app", () => ({
  createApp: () => ({ listen: mocks.listen })
}));

describe("API server listener", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.PORT;
  });

  test("binds only to IPv4 loopback and logs the matching URL", async () => {
    process.env.PORT = "4312";
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await import("../../server/index");

    expect(mocks.listen).toHaveBeenCalledWith(
      4312,
      "127.0.0.1",
      expect.any(Function)
    );
    expect(log).toHaveBeenCalledWith(
      "API server listening on http://127.0.0.1:4312"
    );
  });
});
