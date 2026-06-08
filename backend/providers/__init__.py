"""State providers — adapters that build the `ui_state` dict a pack
expects from a live third-party system.

The DSL explicitly rejects function calls and lambdas (see
`docs/architecture.md`), so list-checks like
``any(r.do_not_contact for r in recipients)`` are illegal at the pack
level. Providers close that gap by pre-aggregating into simple
scalars (``has_flagged_recipient``, ``recipient_count``, …) which the
pack can then compare directly.
"""

from providers.bank import BankStateProvider
from providers.twenty import TwentyStateProvider

__all__ = ["BankStateProvider", "TwentyStateProvider"]
