export function mediaResponse(bytes: Buffer, range: string | null) {
  const headers = new Headers({
    "Content-Type":
      bytes.toString("ascii", 0, 4) === "RIFF" ? "audio/wav" : "audio/mpeg",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
  });
  if (!range) return new Response(new Uint8Array(bytes), { headers });
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2]))
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": "bytes */" + bytes.length },
    });
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, bytes.length - Number(match[2]));
  const end =
    match[1] && match[2]
      ? Math.min(bytes.length - 1, Number(match[2]))
      : bytes.length - 1;
  if (start > end || start >= bytes.length)
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": "bytes */" + bytes.length },
    });
  headers.set("Content-Range", `bytes ${start}-${end}/${bytes.length}`);
  headers.set("Content-Length", String(end - start + 1));
  return new Response(new Uint8Array(bytes.subarray(start, end + 1)), {
    status: 206,
    headers,
  });
}
