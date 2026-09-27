"use client";

import { useState } from "react";

export function EtsyPermissions({
  connected,
  scopeKnown,
  writeAccess,
  orderReadAccess,
  canConnect
}: {
  connected: boolean;
  scopeKnown: boolean;
  writeAccess: boolean;
  orderReadAccess: boolean;
  canConnect: boolean;
}) {
  const [approved, setApproved] = useState(false);
  const [ordersApproved, setOrdersApproved] = useState(false);
  const [pending, setPending] = useState(false);
  const status = !connected
    ? "Not connected"
    : [writeAccess ? "Listing write" : null, orderReadAccess ? "Order read" : null]
      .filter(Boolean).join(" + ") || (scopeKnown ? "Read-only access" : "Permissions unverified");

  return (
    <section className="border-bottom pb-4 mb-4" aria-labelledby="etsy-permissions-heading">
      <div className="d-flex align-items-center flex-wrap gap-3 mb-3">
        <h2 id="etsy-permissions-heading" className="h5 mb-0">Etsy permissions</h2>
        <span className={`badge ${writeAccess ? "text-bg-warning" : "text-bg-secondary"}`}>{status}</span>
        {!connected ? <a className="btn btn-outline-secondary btn-sm" href="/api/auth/etsy/start">Connect Etsy (read-only)</a> : null}
      </div>
      <form action="/api/auth/etsy/start" method="post" className="mb-4" onSubmit={() => setPending(true)}>
        <input type="hidden" name="permission" value="order-read" />
        <div className="alert alert-info" role="note">
          Order read access lets the app retrieve this shop&apos;s Etsy receipts, transactions,
          payment and shipment status. It does not allow changing orders or contacting buyers.
        </div>
        <div className="form-check mb-3">
          <input
            id="approve-etsy-orders"
            className="form-check-input p-0"
            style={{ minHeight: 0 }}
            type="checkbox"
            name="confirmOrderReadAccess"
            value="approved"
            required
            checked={ordersApproved}
            disabled={!canConnect}
            onChange={(event) => setOrdersApproved(event.target.checked)}
          />
          <label className="form-check-label" htmlFor="approve-etsy-orders">
            I approve read-only access to this shop&apos;s Etsy orders.
          </label>
        </div>
        <button type="submit" className="btn btn-primary" disabled={!ordersApproved || pending || !canConnect} aria-busy={pending}>
          {pending ? "Opening Etsy..." : orderReadAccess ? "Reconnect order access" : "Enable Etsy order access"}
        </button>
      </form>
      <form action="/api/auth/etsy/start" method="post" onSubmit={() => setPending(true)}>
        <input type="hidden" name="permission" value="listing-write" />
        <div className="alert alert-warning" role="note">
          Etsy grants general listing edit permission, not section-only permission.
          Connecting does not approve or apply product changes. Each change requires separate approval.
          Automatic Etsy sync remains read-only.
        </div>
        <div className="form-check mb-3">
          <input
            id="approve-etsy-write"
            className="form-check-input p-0"
            style={{ minHeight: 0 }}
            type="checkbox"
            name="confirmWriteAccess"
            value="approved"
            required
            checked={approved}
            disabled={!canConnect}
            onChange={(event) => setApproved(event.target.checked)}
          />
          <label className="form-check-label" htmlFor="approve-etsy-write">
            I approve adding Etsy listing edit permission, not changes to my products.
          </label>
        </div>
        <button type="submit" className="btn btn-warning" disabled={!approved || pending || !canConnect} aria-busy={pending}>
          {pending ? "Opening Etsy..." : writeAccess ? "Reconnect with write access" : "Enable Etsy write access"}
        </button>
      </form>
    </section>
  );
}
