"use client";

import { useEffect, useRef, useState } from "react";

function dateLabel(value, options = { weekday: "short", month: "short", day: "numeric" }) {
  return new Intl.DateTimeFormat("en", options).format(new Date(value));
}

async function readResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const retry = response.headers.get("Retry-After");
    throw new Error(retry ? `${body.error}. Try again in ${retry} seconds.` : body.error || "Something went wrong.");
  }
  return body;
}

export default function BookingPage() {
  const [view, setView] = useState("book");
  const [slots, setSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [booking, setBooking] = useState(null);
  const [reference, setReference] = useState("");
  const [foundBooking, setFoundBooking] = useState(null);
  const [listEmail, setListEmail] = useState("");
  const [listReference, setListReference] = useState("");
  const [myBookings, setMyBookings] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [error, setError] = useState("");
  const pendingRequest = useRef(null);

  async function loadSlots() {
    setLoadingSlots(true);
    try {
      const data = await readResponse(await fetch("/api/ui/slots", { cache: "no-store" }));
      setSlots(data.slots || []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoadingSlots(false);
    }
  }

  useEffect(() => { loadSlots(); }, []);

  async function book(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const payload = { slot_id: selectedSlot, name, email };
    const body = JSON.stringify(payload);
    if (!pendingRequest.current || pendingRequest.current.body !== body) {
      pendingRequest.current = { body, key: crypto.randomUUID() };
    }
    try {
      const result = await readResponse(await fetch("/api/ui/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": pendingRequest.current.key },
        body,
      }));
      setBooking(result);
      pendingRequest.current = null;
      await loadSlots();
    } catch (bookingError) {
      setError(bookingError.message);
    } finally {
      setBusy(false);
    }
  }

  async function lookup(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      setFoundBooking(await readResponse(await fetch(`/api/ui/bookings?id=${encodeURIComponent(reference.trim())}`)));
    } catch (lookupError) {
      setFoundBooking(null);
      setError(lookupError.message);
    } finally {
      setBusy(false);
    }
  }

  async function searchBookings(event, cursor = null) {
    event?.preventDefault();
    setError("");
    setBusy(true);
    try {
      const query = new URLSearchParams({ email: listEmail.trim(), reference: listReference.trim(), limit: "10" });
      if (cursor) query.set("cursor", cursor);
      const result = await readResponse(await fetch(`/api/ui/bookings?${query}`));
      setMyBookings((current) => cursor ? [...current, ...result.bookings] : result.bookings);
      setNextCursor(result.next_cursor);
    } catch (searchError) {
      setMyBookings([]);
      setNextCursor(null);
      setError(searchError.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id) {
    setError("");
    setBusy(true);
    try {
      await readResponse(await fetch(`/api/ui/bookings/${encodeURIComponent(id)}`, { method: "DELETE" }));
      if (listEmail) await searchBookings(null);
      if (foundBooking?.id === id) setFoundBooking((current) => ({ ...current, status: "cancelled" }));
      await loadSlots();
    } catch (cancelError) {
      setError(cancelError.message);
    } finally {
      setBusy(false);
    }
  }

  const groupedSlots = slots.reduce((groups, slot) => {
    const day = new Date(slot.start).toDateString();
    groups[day] ??= [];
    groups[day].push(slot);
    return groups;
  }, {});

  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Koya Clinic home"><span className="brand-mark"><span /></span><span>koya <b>clinic</b></span></a>
        <div className="clinic-label"><span className="open-dot" /> Patient appointments</div>
      </header>

      <section className="intro">
        <div className="intro-copy"><p className="eyebrow">CARE THAT FITS YOUR DAY</p><h1>Make time<br />for your health.</h1><p className="intro-note">Choose a time with our care team. Your appointment is confirmed as soon as you book.</p></div>
        <div className="intro-aside" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="sun-mark">+</div><span className="aside-label">A little more<br />room to feel well.</span></div>
      </section>

      <nav className="view-tabs" aria-label="Appointment options">
        <button className={view === "book" ? "tab active" : "tab"} onClick={() => { setView("book"); setError(""); }}><span className="tab-icon">+</span> Book a visit</button>
        <button className={view === "manage" ? "tab active" : "tab"} onClick={() => { setView("manage"); setError(""); }}><span className="tab-icon search-icon" /> Find an appointment</button>
      </nav>
      {error && <div className="alert" role="alert">{error}</div>}

      {view === "book" ? <section className="booking-layout">
        <div className="slots-panel">
          <div className="section-heading"><div><p className="eyebrow">AVAILABLE TIMES</p><h2>Choose your visit</h2></div><button className="refresh-button" type="button" title="Refresh times" aria-label="Refresh available times" onClick={loadSlots}>↻</button></div>
          {loadingSlots ? <p className="quiet-message">Finding available times…</p> : slots.length === 0 ? <p className="quiet-message">There are no times available right now.</p> : (
            <div className="slot-days">{Object.entries(groupedSlots).map(([day, daySlots]) => <div className="day-group" key={day}><h3>{dateLabel(daySlots[0].start)}</h3><div className="slot-list">{daySlots.map((slot) => <button key={slot.id} type="button" className={`slot-option${selectedSlot === slot.id ? " chosen" : ""}`} disabled={!slot.available || new Date(slot.start) <= new Date()} onClick={() => setSelectedSlot(slot.id)} aria-pressed={selectedSlot === slot.id}><span className="slot-time">{dateLabel(slot.start, { hour: "numeric", minute: "2-digit" })}<small> to {dateLabel(slot.end, { hour: "numeric", minute: "2-digit" })}</small></span><span className="slot-provider">{slot.provider}</span><span className="slot-indicator">{selectedSlot === slot.id ? "✓" : "→"}</span></button>)}</div></div>)}</div>
          )}
        </div>
        <div className="form-panel">{booking ? <div className="confirmation" role="status"><div className="confirmation-mark">✓</div><p className="eyebrow">YOU’RE ALL SET</p><h2>We’ll see you soon, {booking.name.split(" ")[0]}.</h2><p className="confirmation-date">{dateLabel(slots.find((slot) => slot.id === booking.slot_id)?.start || booking.created_at, { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</p><p className="confirmation-detail">A confirmation is saved for <strong>{booking.email}</strong>.</p><div className="reference-line"><span>Booking reference</span><code>{booking.id}</code></div><button className="text-button" onClick={() => { setBooking(null); setSelectedSlot(""); }}>Book another visit ↗</button></div> : <form className="booking-form" onSubmit={book}><p className="eyebrow">YOUR DETAILS</p><h2>Who are we seeing?</h2><p className="form-note">Your details stay with the clinic team.</p><label htmlFor="patient-name">Full name</label><input id="patient-name" autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Ada Obi" /><label htmlFor="patient-email">Email address</label><input id="patient-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /><div className="selected-summary"><span className="summary-icon">◷</span>{selectedSlot ? <span>{dateLabel(slots.find((slot) => slot.id === selectedSlot)?.start, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })}<small>{slots.find((slot) => slot.id === selectedSlot)?.provider}</small></span> : <span>Select a time to continue<small>Your visit time appears here</small></span>}</div><button className="primary-button" type="submit" disabled={busy || !selectedSlot}>{busy ? "Booking…" : "Confirm appointment"}<span>↗</span></button><p className="privacy-note">By booking, you agree to be contacted about this appointment.</p></form>}</div>
      </section> : <section className="manage-layout">
        <div className="manage-column"><p className="eyebrow">LOOK UP A VISIT</p><h2>Have your booking reference?</h2><form className="lookup-form" onSubmit={lookup}><label htmlFor="booking-reference">Booking reference</label><div className="input-action"><input id="booking-reference" required value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Paste your reference" /><button className="primary-button" disabled={busy}>Find ↗</button></div></form>{foundBooking && <BookingDetails booking={foundBooking} busy={busy} onCancel={cancel} />}</div>
        <div className="manage-column"><p className="eyebrow">YOUR APPOINTMENTS</p><h2>See all your visits</h2><form className="lookup-form" onSubmit={(event) => searchBookings(event)}><label htmlFor="list-email">Email address</label><input id="list-email" type="email" required value={listEmail} onChange={(event) => setListEmail(event.target.value)} placeholder="you@example.com" /><label htmlFor="list-reference">Booking reference</label><div className="input-action"><input id="list-reference" required value={listReference} onChange={(event) => setListReference(event.target.value)} placeholder="Reference from your confirmation" /><button className="primary-button" disabled={busy}>Search ↗</button></div></form>{myBookings.length > 0 && <div className="appointment-results">{myBookings.map((item) => <BookingDetails key={item.id} booking={item} busy={busy} onCancel={cancel} compact />)}{nextCursor && <button className="text-button" onClick={() => searchBookings(null, nextCursor)}>More appointments ↓</button>}</div>}</div>
      </section>}

      <footer className="footer"><span>KOYA CLINIC</span><span>Thoughtful care, made simple.</span><span>© 2026</span></footer>
    </main>
  );
}

function BookingDetails({ booking, busy, onCancel, compact = false }) {
  return <article className={`booking-result${compact ? " compact" : ""}`}><div className="result-topline"><span className={`status-tag ${booking.status}`}>{booking.status}</span><code>{booking.id}</code></div><h3>{booking.name}</h3><p>{booking.email}</p><p className="result-slot">Slot {booking.slot_id} · booked {dateLabel(booking.created_at, { month: "short", day: "numeric", year: "numeric" })}</p>{booking.status === "confirmed" && <button className="cancel-button" disabled={busy} onClick={() => onCancel(booking.id)}>Cancel appointment</button>}</article>;
}