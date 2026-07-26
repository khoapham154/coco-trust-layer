# Agent-banking demo script

Hand this to whoever records the agent-banking demo. One agent, about two and a half minutes, from an ordinary payment to the actions that need a second look. The brackets tell the recorder what to click. The canonical view is the Agent Bank workspace in the dashboard.

## Opening (~15s)

A bank has just handed an AI agent the ability to move money. The agent is fast, it never stops, and it does whatever the API lets it do.

We built Coco for the moment this gets scary. When that agent is about to send two million dollars, who governs it in real time, and who decides whether it should?

## Beat 1: a normal day (~20s)

[SHOW: pick "Run payroll", click Initiate, let the stages light up.]

Here is the agent on an ordinary Tuesday, running payroll. Discovery finds the bank's tools, Visa confirms it is a known agent, Mastercard confirms it is allowed to move money. Coco reads the live account, finds nothing wrong, and lets the payment through. Five thousand dollars cleared, and Coco logged every step. When the action is safe, you barely notice Coco is there.

## Beat 2: the moment of truth (~40s)

[SHOW: pick "Pay a $2M supplier invoice", Initiate. Pause as stages 1 to 3 go green.]

Now the same agent has a different instruction: pay a two million dollar invoice from Harbourline Manufacturing, a supplier this account has paid for years. What nobody in the chain can see is that the invoice was tampered with upstream. One field was swapped, the account number. The name still reads right, the amount still reads right, but the money is now pointed at an account the attacker controls.

Watch the first three layers go green. Identity confirmed, authorisation confirmed, and the bank's own payment API checks the request and calls it valid. Every layer so far has said yes. If this is where you stop, the money is already gone.

[SHOW: stage four reveals BLOCK.]

Then Coco reads the live account the way a person would. The payee is approved. The amount sits inside the limit somebody set last quarter. And the destination does not match the account this supplier is approved to receive at. Coco blocks the transfer before it reaches SWIFT, names the rule that fired, and writes the reason to the audit log. Without Coco, every earlier layer has already said yes, so the two million leaves the account and lands with the attacker, and the bank finds out when the real supplier calls about an unpaid invoice. This one does not come back.

## Beat 3: judgement, not a rule (~20s)

[SHOW: pick "Settle a $250k invoice", Initiate, stage four reveals ESCALATE.]

One last transfer. A quarter of a million dollars to a supplier. The payee is approved, the destination matches the account on file, nothing is technically wrong with it. It is simply a lot of money for an agent to release on its own. Without Coco, nothing stops it: the agent pays a quarter of a million on its own authority, and no person sees it until it is already gone. With Coco, stage four does not decide this one. It pauses the payment, sends it to a human to approve, and logs whatever they choose. The agent stays fast on the routine work, and a person owns the big release.

## Beat 4: the same judgement, everywhere the agent acts (~35s)

[SHOW: open "Agent actions" in the Agent Bank workspace.]

Moving money is only one thing this agent does. It also adds new payees, changes card limits, and pulls customer data. Coco governs all of it on the same contract.

[SHOW: run "Add a payee that fails account verification".] Here the agent adds a new payee whose account details do not match the record at the receiving bank. That is how fraud usually starts, one quiet new beneficiary. Coco blocks it before a dollar can ever be sent there.

[SHOW: run "Raise a card to 250,000".] Here it raises a corporate card limit to a quarter of a million. Nothing is wrong with the card, the number is just high, so Coco sends it to a manager.

[SHOW: run "Export with no stated purpose".] And here it tries to export customer records with no reason on file. Coco blocks the pull, because customer data does not leave without a stated purpose.

## Landing: why this is big (~25s)

[SHOW: pan across the dashboard, the live feed and the audit ledger filling in.]

This is the full picture. Visa works on who the agent is. Mastercard and PayPal work on what it is allowed to do. Darwinium and Chainalysis, the AML tools, catch fraud after it has happened. Every one of them trusts what the API says. Coco is the one layer that checks what is actually true in the account, in the moment, before the money moves.

And it is not only wires. Every action the agent takes against the bank runs through the same check, against a policy you can read and change. That is what lets a bank hand an agent the keys to real money, instead of keeping a person on every single transaction.

## Questions they will ask

**Why does nothing else catch the swapped account number?**

Because every other control checks something that is genuinely fine. Identity passes, because the agent's credential is real. Screening passes, because the attacker's account is clean, no history, nothing to flag. The spend cap passes, because two million sits inside a limit somebody set last quarter. The payment API accepts the call, because it only answers whether the request is technically valid. Not one of them checks the only thing that mattered, whether this is the payee the client actually intended. That record lives in the bank's beneficiary register, and the payment API does not carry it.

**Would settlement not reject it anyway?**

No. The receiving account is real, open and clean, so settlement completes without a murmur. This is authorised push-payment fraud: once the money lands it is moved on within minutes, and recovery rates are low. On instant rails there is no window at all. Coco stops it before it commits, with the reason logged.

**Why does the $250k need a human when nothing is wrong with it?**

The bank sets the line for what an agent may clear alone. Above that line, releasing money with no sign-off breaks dual control, a standard banking safeguard. The bank picks the number, and Coco holds anything above it for a person.

**Is this just a rules engine?**

No. Coco reads the live state of the account, the part the API does not expose, and rules at the moment of the action, before it commits. The bank's own team writes the rules in plain policy, a change is live in seconds with no redeploy, and every decision is written to an audit trail you can download.
