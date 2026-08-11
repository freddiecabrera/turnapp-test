import { Router, RouterOptions } from "express";

/** The registration methods this app uses. `router.route()` is not one of them. */
const REGISTRARS = ["use", "all", "get", "post", "put", "patch", "delete"] as const;

/**
 * `express.Router()`, but a handler that rejects reaches the error middleware
 * instead of killing the process.
 *
 * Express 4 calls each handler and ignores its return value. An `async` handler
 * returns a promise, so a rejection inside one is never seen by the router: it
 * becomes an unhandled rejection, and Node 20 defaults to
 * `--unhandled-rejections=throw`, which exits. One malformed request from any
 * authenticated account is therefore enough to take the API down for everyone —
 * a null byte in any string that reaches Postgres does it (`22021 invalid byte
 * sequence for encoding "UTF8": 0x00`), and every route in this app is `async`.
 *
 * Wrapping happens at registration time rather than per route so the boundary
 * cannot be forgotten one handler at a time. **New routers must be created with
 * this factory, not `express.Router()`** — that is the one thing keeping this
 * from being repo-wide by construction.
 *
 * Hand-rolled rather than `express-async-errors`, which monkey-patches Express
 * internals to achieve the same thing and is larger than what it replaces.
 * Express 5 routes rejections natively, so this is deletable on that upgrade.
 */
export function asyncRouter(options?: RouterOptions): Router {
  const router = Router(options);

  // Cast once: the real signatures are heavily overloaded, and re-deriving them
  // per method buys nothing when every argument is forwarded untouched.
  const registrars = router as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const method of REGISTRARS) {
    const register = registrars[method].bind(router);
    registrars[method] = (...args: unknown[]) => register(...args.map(wrap));
  }

  return router;
}

/**
 * Route a handler's rejection to `next`, leaving everything else untouched.
 *
 * Paths, arrays and option objects pass straight through. Arity is the only way
 * to tell an error handler `(err, req, res, next)` from a normal one, and
 * Express reads it off `Function.length` — so each wrapper has to declare the
 * same count, or a wrapped error handler would silently stop being one.
 */
function wrap(handler: unknown): unknown {
  if (typeof handler !== "function") return handler;

  const call = (args: unknown[], next: unknown) => {
    const fail = next as (err: unknown) => void;
    try {
      const result = (handler as (...a: unknown[]) => unknown)(...args);
      // A sync handler returns undefined or the `res` it just wrote; only a
      // thenable can still fail after this call returns.
      if (isThenable(result)) Promise.resolve(result).catch(fail);
    } catch (err) {
      fail(err);
    }
  };

  return handler.length === 4
    ? (err: unknown, req: unknown, res: unknown, next: unknown) => call([err, req, res, next], next)
    : (req: unknown, res: unknown, next: unknown) => call([req, res, next], next);
}

function isThenable(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}
