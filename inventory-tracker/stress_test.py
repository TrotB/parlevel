"""Stress test ParLevel with authenticated sessions."""
import concurrent.futures
import http.cookiejar
import json
import statistics
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8081"
ENDPOINTS = [
    "/api/stats",
    "/api/items",
    "/api/categories",
    "/api/low-stock",
    "/api/reorder",
    "/api/items/barcode/06700000103",
]
CONCURRENT = 40
REQUESTS_PER_WORKER = 25


def make_opener():
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    login = json.dumps({"store_code": "cornershop", "pin": "1234"}).encode()
    req = urllib.request.Request(
        f"{BASE}/api/auth/login",
        data=login,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    opener.open(req, timeout=15).read()
    return opener


def fetch(opener, url: str, method: str = "GET", body: dict | None = None):
    start = time.perf_counter()
    data = json.dumps(body).encode() if body else None
    headers = {"Accept": "application/json"}
    if data:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with opener.open(req, timeout=15) as resp:
            resp.read()
            return time.perf_counter() - start, resp.status, None
    except urllib.error.HTTPError as e:
        return time.perf_counter() - start, e.code, str(e)
    except Exception as e:
        return time.perf_counter() - start, None, str(e)


def worker(opener, worker_id: int):
    results = []
    for i in range(REQUESTS_PER_WORKER):
        path = ENDPOINTS[(worker_id + i) % len(ENDPOINTS)]
        results.append(fetch(opener, BASE + path))
    return results


def adjust_worker(opener):
    results = []
    for delta in [1, -1, 1, -1, 1]:
        results.append(fetch(opener, f"{BASE}/api/items/1/adjust", "POST", {"delta": delta, "reason": "manual"}))
    return results


def main():
    print("ParLevel stress test (authenticated)\n")
    try:
        opener = make_opener()
    except Exception as e:
        print(f"Login failed: {e}")
        return

    start = time.perf_counter()
    all_results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENT + 5) as pool:
        futures = [pool.submit(worker, opener, i) for i in range(CONCURRENT)]
        futures += [pool.submit(adjust_worker, opener) for _ in range(5)]
        for f in concurrent.futures.as_completed(futures):
            all_results.extend(f.result())

    elapsed = time.perf_counter() - start
    latencies = [r[0] * 1000 for r in all_results]
    errors = [r for r in all_results if r[1] != 200]
    total = len(all_results)

    print(f"Requests:  {total}")
    print(f"Duration:  {elapsed:.2f}s")
    print(f"Throughput:{total / elapsed:.1f} req/s")
    print(f"Success:   {(total - len(errors)) / total * 100:.1f}%")
    print(f"Latency ms — avg:{statistics.mean(latencies):.1f} p95:{sorted(latencies)[int(len(latencies)*0.95)]:.1f}")

    if errors:
        print(f"Errors: {len(errors)}")
    else:
        print("All requests succeeded.")


if __name__ == "__main__":
    main()
