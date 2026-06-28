# Securities-lending demo script

One agent on a lending desk, three loans, about ninety seconds. Switch to the
Securities Lending workspace with the toggle top-left. The whole demo is one
contrast: the booking system accepts every request, and Coco is the only layer
that reads the live desk and stops the loan that should not commit.

## Opening (~10s)

A lending desk has given an AI agent the power to book loans. It does whatever
the booking system accepts, fast and without stopping. We built Coco for the
moment that gets expensive.

## Beat 1: a routine loan (~15s)

[SHOW: pick "Book a routine loan", click Book loan.]

Here the agent lends 10,000 Apple shares to Citadel. Coco reads the live
blotter, finds inventory free, the borrower under its limit and no recall, and
lets the loan through. When the action is safe, you barely notice Coco is there.

## Beat 2: the loan that should not commit (~35s)

[SHOW: pick "Book past the borrower's cap", click Book loan. Pause as Locate and Rate go green.]

Now the same agent lends another 10,000 Apple shares, this time to Jane Street.
The booking API accepts it: the request is well-formed and the desk is funded.
Every layer so far has said yes.

[SHOW: the Book loan stage reveals BLOCK; read the Without Coco / With Coco panel.]

Then Coco reads the live state. Jane Street is already near its exposure cap,
and this loan would push it over. Coco blocks the booking before it commits and
names the rule. Without Coco the loan books, and the breach surfaces next
morning in reconciliation, a limit the desk has to unwind and report. The cap
lived in the desk's own records. The booking request never carries it, so a
fast agent never sees it.

## Beat 3: judgement, not a rule (~20s)

[SHOW: pick "Book a large notional", click Book loan.]

One more loan. 50,000 Apple shares, about nine and a half million dollars.
Nothing is wrong with it: clean borrower, inventory there, no recall. It is
simply a large position for an agent to release alone. Coco does not block it.
It pauses the booking, sends it to a human, and logs the decision.

## Close (~15s)

[SHOW: open the Audit Ledger.]

Every decision lands in one ledger with the rule that fired and the live state
Coco read. The same engine governs collateral, rates, recalls and reporting on
the Lifecycle actions screen, and every contract is anchored to a FINOS Common
Domain Model event, so Coco speaks the industry's own language.
