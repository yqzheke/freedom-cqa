import { it, expect } from "vitest";
import { mediaResponse } from "../../lib/media";
it("serves verified byte ranges for seekable playback", async () => {
  const b = Buffer.from("123456789");
  const r = mediaResponse(b, "bytes=2-4");
  expect(r.status).toBe(206);
  expect(await r.text()).toBe("345");
  expect(await mediaResponse(b, "bytes=-2").text()).toBe("89");
  expect(mediaResponse(b, "bytes=12-").status).toBe(416);
});
