;; fakfun-wallet-v15: fakfun-wallet-v14 with the config surface moved behind the passkey.
;;
;; SIX CHANGES. Everything else is fakfun-wallet-v14 verbatim.
;;
;; 1. enroll-dual-stacking REMOVED. Dual stacking as this template reached it was
;;    a pox-4-era mechanism, built against xbtc-sbtc-swap-v2.enroll-trait from the
;;    same generation as the stack-stx-fast-pool and delegate-stx paths that came
;;    out in the pox-5 port. pox-4's last reward cycle was 140 and new enrolment
;;    no longer works, so the entry point was surface area for nothing. The
;;    function, its trait import, the challenge and the core event are all gone.
;;
;; 2. set-wallet-config NEEDS THE PASSKEY. This is the substantive change. In v4
;;    both halves were (is-authorized none), admin key alone, so the key the
;;    cooldown protects against could also switch the cooldown off: signal a
;;    change, wait one cooldown, set cooldown-period to u0, and every delay in the
;;    wallet collapses. signal-config-change stays admin-only, so the two steps
;;    now require two DIFFERENT factors and a stolen admin key can start a config
;;    change but never finish one.
;;
;;    THE VALUES ARE COMMITTED AT SIGNAL TIME. signal-config-change carries the
;;    three values into pending-config and prints them; set-wallet-config takes
;;    only the signature and applies what is pending. The draft put the values on
;;    the confirm step, which left the cooldown window useless -- core's
;;    log-signal-config-change carries no arguments, so an observer knew a change
;;    was coming and could not learn what until it landed. Now the values are
;;    public the moment the clock starts and the passkey confirms exactly what was
;;    signalled. Bounds are asserted at signal, so a bad value fails immediately
;;    rather than after a cooldown. Same shape as propose/confirm-max-gas-amount.
;;    BOTH SIGNATURES CHANGED: signal-config-change gains the three values,
;;    set-wallet-config loses them and keeps only sig-auth. get-pending-config
;;    reads what is queued.
;;
;; 3. confirm-max-gas-amount NEEDS THE PASSKEY, same reasoning.
;;    propose-max-gas-amount stays admin-only. Both hashes BIND THE VALUES, so the
;;    passkey approves specific numbers rather than consenting to "a change" a
;;    compromised admin could then fill in differently.
;;    BOTH SIGNATURES CHANGED: these two functions now take a required sig-auth.
;;
;; 4. cooldown-period IS BOUNDED, floor MIN-COOLDOWN u144 and ceiling
;;    MAX-CONFIG-COOLDOWN u4032. v4 bounded neither. No floor let the delays be
;;    collapsed to zero; no ceiling let an absurd value freeze every pending
;;    operation instead, and after a recovery the config is passkey-gated and can
;;    no longer be repaired. err-cooldown-too-long u4019 was declared in v4 and
;;    never used; it is wired up here.
;;
;; 5. RECOVERY AT ONBOARD IS NOT AVAILABLE HERE. This wallet's onboard takes only
;;    the pubkey -- recovery-address is written solely by propose/confirm-recovery.
;;    So a wallet whose owner never proposes one has NO recovery path, the same
;;    permanent-loss vector juice-safe-v5 closes. Closing it here needs recovery
;;    attached to the admin-seating step or asserted before the first fund move.
;;    OPEN, deliberately not changed in this pass.
;;
;; 6. THIS CONTRACT CAN NEVER BE SEATED AS ITS OWN ADMIN. Guarded at all three
;;    admins write paths, plus propose-recovery. as-contract? rebinds tx-sender
;;    to this contract, so if it appeared in admins a caller-supplied gas station
;;    could re-enter with sig-auth none and pass is-admin-calling -- a relay
;;    compromise alone would drain the wallet. That attack is verified failing on
;;    v4 and v14 (see README-v4-v14-sims.md), but nothing ENFORCED the precondition
;;    it depends on. Clarity's principal type does not distinguish a standard
;;    principal from a contract one.
;;
;; 7. NO POST-INIT PASSKEY REGISTRATION. propose-admin-pubkey and
;;    confirm-admin-pubkey are REMOVED, along with signal/confirm-pubkey-cooldown-
;;    change and the pending-pubkey / pending-pubkey-cooldown vars. 98 lines.
;;
;;    WHY. Both halves of the pubkey pair were (is-admin-calling), admin key alone,
;;    so a stolen admin key could mint itself a passkey -- propose, wait
;;    pubkey-cooldown-period, confirm -- and then hold BOTH factors. Worse, both
;;    halves of the cooldown pair were (is-authorized none) with a ceiling but NO
;;    FLOOR, so the same key could first set the period to u0 and mint a passkey in
;;    a single block. Passkey-gating the config surface (changes 2 and 3) is worth
;;    little while that path exists.
;;
;;    The cooldown pair went too because it was provably dead once the pubkey pair
;;    left: accept-admin-proposal asserts (not is-initialized), so admin seating
;;    runs exactly once, and post-init nothing reads pubkey-cooldown-period.
;;
;;    WHAT IT COSTS. Losing the passkey device is now permanent, as on the safe.
;;    That costs governance only, never assets: stx-transfer, sip010-transfer,
;;    sip009-transfer, sbtc-initiate-withdrawal and extension-call all take an
;;    OPTIONAL sig-auth, and every execute-pending-* slow path takes none at all,
;;    so the admin key alone still moves every asset class out. The recovery drill
;;    is to drain to a fresh wallet, not to keep using this one.
;;
;;    SECOND BENEFIT, unplanned: it makes the GAS-EXEMPT on confirm-transfer-wallet
;;    airtight. See the note above pay-gas-accounted -- v11's own comment flagged
;;    the loop as "not impossible here, only expensive" and named this as the one
;;    flag to flip.
;;
;; DEPLOY ORDER. smart-wallet-standard-auth-helpers-v9 MUST deploy first -- this
;; contract references it by fully-qualified principal for the two new challenges
;; and fails analysis without it. Then this contract, then
;; fakfun-wallet-core.set-verified-contract(<this>, none), then onboard.
;;
;; CONSEQUENCE FOR THE BACKEND. pillar-be's /api/bot/enroll-dual-stacking cron
;; selects wallets by version and calls enroll-dual-stacking by name. It must skip
;; this template or it will broadcast calls to a function that is not here.
;;
;; fakfun-wallet-v14: fakfun-wallet-v11 plus a metered, fused gas channel.
;;
;; v11 left one sBTC outflow uncounted. A gasless call pays a caller-supplied
;; <gas-trait> station up to max-gas-amount, and that payment touched no
;; counter and no ceiling -- so a relayer could skim the max on every call the
;; user signs, forever, against no cap. This wallet has 27 gasless surfaces
;; (transfers, extension-call, the whole faktory-* family, staking,
;; wager-deposit), so it had the most to leak. See the block on
;; spent-this-period and pay-gas-accounted below, and README-GAS-METERING.md.
;;
;; Everything else is v11 verbatim. Only register-wallet's argument changes, to
;; name this contract -- see the NOTE at onboard.
;;
(use-trait extension-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.extension-trait.extension-trait)
(use-trait gas-trait 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.gas-station-trait.gas-station-trait)

(use-trait sip-010-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)
(use-trait sip-009-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait.nft-trait)
(use-trait pool-trait 'SP2ZNGJ85ENDY6QRHQ5P2D4FXKGZWCKTB2T0Z55KS.dexterity-traits-v0.liquidity-pool-trait)
(use-trait dex-trait 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.faktory-dex-trait-v2.dex-trait)
(use-trait pre-trait 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.prelaunch-faktory-trait-v1.prelaunch-trait)
(use-trait token-trait 'SP3XXMS38VTAWTVPE5682XSBFXPTH7XCPEBTX8AN2.faktory-trait-v1.sip-010-trait)
(use-trait nftmarket-trait 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-nftmarket-trait.nftmarket-trait)

(impl-trait 'SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK.pillar-wallet-trait.pillar-wallet-trait)

(define-constant err-unauthorised (err u4001))
(define-constant err-invalid-signature (err u4002))
(define-constant err-forbidden (err u4003))
(define-constant err-unregistered-pubkey (err u4004))
(define-constant err-not-admin-pubkey (err u4005))
(define-constant err-signature-replay (err u4006))
(define-constant err-no-auth-id (err u4007))
(define-constant err-no-message-hash (err u4008))
(define-constant err-inactive-required (err u4009))
(define-constant err-no-pending-recovery (err u4010))
(define-constant err-not-whitelisted (err u4011))
(define-constant err-in-cooldown (err u4012))
(define-constant err-invalid-operation (err u4013))
(define-constant err-already-executed (err u4014))
(define-constant err-vetoed (err u4015))
(define-constant err-not-signaled (err u4016))
(define-constant err-cooldown-not-passed (err u4017))
(define-constant err-threshold-exceeded (err u4018))
(define-constant err-cooldown-too-long (err u4019))
(define-constant err-cooldown-too-short (err u4031))
(define-constant err-no-pending-transfer (err u4020))
(define-constant err-already-initialized (err u4022))
(define-constant err-token-locked (err u4023))
(define-constant err-limit-expired (err u4024))
(define-constant err-limit-not-hit (err u4025))
(define-constant err-init-already-proposed (err u4026))
(define-constant err-no-pending-init (err u4027))
(define-constant err-init-not-pending-admin (err u4028))
(define-constant err-init-not-accepted (err u4029))
(define-constant err-zero-amount (err u4030))
(define-constant err-fatal-owner-not-admin (err u9999))

(define-constant INACTIVITY-PERIOD u52560)
(define-constant MAX-GAS-CEILING u10000)

(define-constant MAX-CONFIG-COOLDOWN u4032)

;; Floor and ceiling on cooldown-period. v4 bounded NEITHER, and both directions
;; were footguns. With no floor, a stolen admin key could signal a change, wait
;; one current cooldown, set cooldown-period to u0, and collapse every delay in
;; the wallet at once -- the cooldown existed to protect against exactly that key.
;; With no ceiling, an absurd value froze every pending operation instead, the
;; same footgun mirrored, and after a recovery the config is passkey-gated and can
;; no longer be repaired. The ceiling reuses MAX-CONFIG-COOLDOWN: the wait for a
;; config change was already clamped to it, so nothing gains from a cooldown
;; longer than the longest wait the contract will ever enforce.
;; err-cooldown-too-long u4019 was declared in v4 and never used; it is wired up
;; here, which is what it was clearly for.
(define-constant MIN-COOLDOWN u144)
(define-constant DEPLOYED-BURNT-BLOCK burn-block-height)
(define-constant SBTC-CONTRACT 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token)
(define-constant FAKFUN-DEPLOYER 'SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK)
(define-constant PUBK 0x000000000000000000000000000000000000000000000000000000000000000000)

(define-constant RP-ID-HASH-FAKFUN-COM 0x5e8ba70d734d2bd57e0225bfd9a25f2c4d70db36fa1128e5eeb00cdab7a1ccdb)
(define-constant RP-ID-HASH-FAK-FUN 0xb877fea5df49f6d2fe544db0c7ced754f117ade85f60266bc217db3b239f2249)

(define-constant POX5 'SP000000000000000000002Q6VF78.pox-5)

;; The Juice signer CONTRACT, not the pool operator EOA. pox-4 delegated to an
;; address (SP1JAG6TV2...); pox-5 derives the signer identity as
;; (contract-of signer-manager), so the pool is named by contract now.
(define-constant JUICE-SIGNER
  'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.juice-pool-stx-signer)

;; Maximum lock pox-5 accepts. NOT a commitment: unstake truncates a staker's
;; shares to current-cycle + 1 whenever it is called, so 96 buys the longest
;; auto-rolling position available rather than locking anyone in for 96 cycles.
;; Matches what juiceofbtc.com/stake passes, so a wallet and an EOA behave alike.
(define-constant NUM-CYCLES u96)

(define-constant OPCODE-BUY 0x00)
(define-constant OPCODE-SELL 0x01)
(define-constant OPCODE-BUY-SEATS 0x02)
(define-constant OPCODE-REFUND 0x03)

(define-constant BOB-CONTRACT 'SP2VG7S0R4Z8PYNYCAQ04HCBX1MH75VT11VXCWQ6G.built-on-bitcoin-stxcity)
(define-constant BOB-BURN-AMOUNT u1000000)

(define-constant EXECUTE-OP-BUY 0x00)
(define-constant EXECUTE-OP-SELL 0x01)
(define-constant EXECUTE-OP-ADD-LIQ 0x02)
(define-constant EXECUTE-OP-REMOVE-LIQ 0x03)

(define-constant NFT-OP-LIST 0x00)
(define-constant NFT-OP-BUY 0x01)
(define-constant NFT-OP-UNLIST 0x02)
(define-constant NFT-OP-UPDATE-PRICE 0x03)
(define-constant NFT-OP-UPDATE-FT 0x04)

(define-data-var last-activity-block uint burn-block-height)
(define-data-var recovery-address principal 'SP000000000000000000002Q6VF78)
(define-data-var initial-pubkey (buff 33) PUBK)
(define-data-var is-initialized bool false)
(define-data-var pubkey-initialized bool false)

(define-data-var pending-init-admin {
  new-admin: principal,
  proposed-at: uint,
  accepted: bool,
} {
  new-admin: 'SP000000000000000000002Q6VF78,
  proposed-at: u0,
  accepted: false,
})

(define-data-var owner principal 'SP000000000000000000002Q6VF78)
(define-data-var pending-recovery principal 'SP000000000000000000002Q6VF78)
(define-data-var pending-transfer principal 'SP000000000000000000002Q6VF78)

(define-fungible-token ect)

(define-map used-pubkey-authorizations
  (buff 32)
  (buff 33)
)

(define-data-var wallet-config {
  stx-threshold: uint,
  sbtc-threshold: uint,
  cooldown-period: uint,
  config-signaled-at: (optional uint),
} {
  stx-threshold: u100000000,
  sbtc-threshold: u100000,
  cooldown-period: u144,
  config-signaled-at: none,
})

;; Read only by confirm-admin-with-signature, i.e. during the one-time admin
;; seating -- accept-admin-proposal asserts (not is-initialized), so that flow
;; runs exactly once. It is a var rather than a constant purely for lineage: v14
;; had signal/confirm-pubkey-cooldown-change to retune it, and those are gone.
;;
;; They are gone because they were pointless AND dangerous. Pointless: post-init
;; nothing reads this value, so changing it changed nothing. Dangerous: both halves
;; were (is-authorized none) with a ceiling but NO FLOOR, so a stolen admin key
;; could set it to u0 and then mint itself a passkey in a single block via
;; propose/confirm-admin-pubkey -- which is also gone. Nothing writes this var now.
(define-data-var pubkey-cooldown-period uint u432)
(define-data-var max-gas-amount uint u1000)

(define-data-var token-lock-enabled bool false)

;; gas is a THIRD counter and a DISJOINT one: a fee lands in gas and
;; nowhere else, a transfer lands in sbtc and nowhere else. Both are sats,
;; but they meter two independent channels against two independent caps --
;; sbtc against sbtc-threshold (which decides whether a transfer executes now
;; or queues as a pending op), gas against max-gas-per-period (which decides
;; whether a gasless call is allowed to pay a station at all).
;;
;; NOT overlapping, and that is deliberate. Charging the fee to sbtc as well
;; would buy no safety -- the fee is already capped by the gas fuse, so the
;; second count can only ever bite AFTER the first one already would have --
;; while quietly spending the transfer budget: 25 calls at the u1000 default is
;; a quarter of the u100000 default threshold, i.e. sBTC transfers start queuing
;; early for a reason the user cannot see. Two channels, two caps, no crosstalk.
;;
;; Consequence for readers: neither counter alone is "sBTC out this period".
;; That total is (+ sbtc gas), and it is more useful shown as two numbers --
;; what you sent vs what you paid to relay -- than as one.
(define-data-var spent-this-period {
  stx: uint,
  sbtc: uint,
  gas: uint,
  period-start: uint,
} {
  stx: u0,
  sbtc: u0,
  gas: u0,
  period-start: DEPLOYED-BURNT-BLOCK,
})

(define-private (get-current-spent)
  (let (
      (spent (var-get spent-this-period))
      (config (var-get wallet-config))
      (period-expired (> burn-block-height
        (+ (get period-start spent) (get cooldown-period config))
      ))
    )
    (if period-expired
      {
        stx: u0,
        sbtc: u0,
        gas: u0,
        period-start: burn-block-height,
      }
      spent
    )
  )
)

(define-private (add-spent-stx (amount uint))
  (let ((current (get-current-spent)))
    (var-set spent-this-period
      (merge current { stx: (+ (get stx current) amount) })
    )
  )
)

(define-private (add-spent-sbtc (amount uint))
  (let ((current (get-current-spent)))
    (var-set spent-this-period
      (merge current { sbtc: (+ (get sbtc current) amount) })
    )
  )
)

;; Touches gas ONLY -- see the note on spent-this-period. A fee must not also
;; land in sbtc, or the transfer budget silently pays for relaying.
(define-private (add-spent-gas (amount uint))
  (let ((current (get-current-spent)))
    (var-set spent-this-period
      (merge current { gas: (+ (get gas current) amount) })
    )
  )
)

(define-constant GAS-ENFORCED true)
(define-constant GAS-EXEMPT false)

;; How many max-price gasless calls one period may fund. 25 * the u1000 default
;; = 25000 sats per cooldown-period (u144 blocks, ~1 day); at the u10000
;; MAX-GAS-CEILING it is 250000. Sized to sit well clear of any plausible day of
;; real use while still turning "unbounded skim" into a bounded one.
(define-constant GAS-CALLS-PER-PERIOD u25)

(define-private (max-gas-per-period)
  (* (var-get max-gas-amount) GAS-CALLS-PER-PERIOD)
)

;; Gas paid to a station is sBTC LEAVING the safe, so it gets metered -- on its
;; own channel, gas. Before this, the gas path was the one sBTC outflow that
;; touched no counter at all: a relayer could skim up to max-gas-amount on every
;; gasless call the user signs, indefinitely, against no cap of any kind. With
;; 27 gasless surfaces on this wallet -- transfers, extension-call, the whole
;; faktory-* trading family, staking, wager-deposit -- that is a lot of skim.
;;
;; The amount charged is the safe's own BALANCE DELTA across the call, not
;; <gas-trait>'s get-gas-amount: the station is caller-supplied, so anything it
;; reports about itself is unverified. The delta is what actually left, and it
;; is bounded by the same max-gas-amount post-condition that already guards the
;; call. A station that somehow sends sBTC IN is charged nothing rather than
;; underflowing -- credits do not refill the budget.
;;
;; enforce decides whether the GAS FUSE is live for this call. Metering alone
;; stops no drain -- a counter nobody checks is just bookkeeping. GAS-ENFORCED
;; caps the skim, by reverting the whole call when this fee would push the
;; period's gas total past max-gas-per-period.
;;
;; The ceiling is derived, not fixed: max-gas-amount * GAS-CALLS-PER-PERIOD. So
;; the cap is really "N gasless calls per period" regardless of what a single
;; fee costs, and raising max-gas-amount raises the ceiling with it -- which is
;; safe precisely because that raise is itself two-step and cooldown-gated (see
;; propose-max-gas-amount). A flat sat constant would have silently tightened
;; into a brick wall every time max-gas-amount went up.
;;
;; Deliberately NOT gated on sbtc-threshold, and deliberately not counted there
;; either. Gating on it would make sbtc-threshold a global gasless kill-switch:
;; almost none of the 27 enforced paths move sBTC, so one large under-threshold
;; transfer would leave a few sats of headroom and then brick unstake,
;; veto-operation, sip009-transfer, extension-call and every faktory-* call --
;; none of which spend sBTC -- until the period rolled. Merely COUNTING there is
;; wrong for the quieter reason given on spent-this-period: it adds no cap the
;; fuse does not already impose, and spends the transfer budget to do it.
;;
;; GAS-EXEMPT is granted to exactly ONE call, confirm-transfer-wallet, on the
;; grounds that it is the terminal exit ramp and must not be blockable.
;;
;; THAT EXEMPTION IS NOW AIRTIGHT, and it was not in v11/v14. The v11 comment
;; here read: "v11 keeps propose-admin-pubkey / confirm-admin-pubkey, so a new
;; owner CAN register a passkey and reopen the surface. The loop is therefore not
;; impossible here, only expensive... If that is judged too loose, this is the one
;; flag to flip."
;;
;; The flag is flipped. v15 removes propose-admin-pubkey and
;; confirm-admin-pubkey, so passkeys are fixed at the one-time init exactly as on
;; the juice safe: after a transfer the old pubkey maps to a non-admin,
;; is-admin-pubkey fails, and NO further gasless call of any kind is possible.
;; One call, then the surface is gone. The loop is impossible now, not merely
;; expensive.
;;
;; This was not the reason for the removal -- see the header -- but it is the
;; second thing the removal bought.
;; NOTE: unwrap-panic here is LOAD-BEARING -- do not 'clean it up' to try!.
;; try! must read the err value out to propagate it, which requires the err
;; type to be resolved; at Clarity 6 it is not, and contract INIT aborts with
;; (err none) / vm_error "attempted to obtain 'err' value from response, but
;; 'err' type is indeterminate". That is what killed the juice-safe-v3 and
;; fakfun-wallet-v12 deploys (0xc84209a5..., 0x34aa0304...) and it reproduces
;; in isolation at C6 even with a literal target (simul-c6-bisect.js).
;; unwrap-panic discards the err instead of reading it, so it needs no type.
;; clarinet flags unwrap-panic as a warning and cannot see the abort at all.
;;
;; The call TARGET is also the literal, not the SBTC-CONTRACT constant,
;; even though the allowance below happily takes the constant. A constant that
;; is also used as a plain principal value (with-ft, and the is-eq comparisons
;; in sip010-transfer) analyses as principal, so contract-call? cannot resolve
;; get-balance's signature, the response's err type comes back indeterminate,
;; and try! aborts contract init with (err none) -- vm_error "attempted to
;; obtain 'err' value from response, but 'err' type is indeterminate". That is
;; what killed the first juice-safe-v3 / fakfun-wallet-v12 deploys
;; (0xc84209a5..., 0x34aa0304...). clarinet does NOT catch it: it skips type
;; checking on constant-target contract-calls entirely. POX5 gets away with the
;; constant only because it is never used as a value anywhere else.
(define-private (pay-gas-accounted
    (g <gas-trait>)
    (enforce bool)
  )
  (let ((before (unwrap-panic (contract-call?
      'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token get-balance
      current-contract
    ))))
    (try! (as-contract?
      ((with-ft SBTC-CONTRACT "sbtc-token" (var-get max-gas-amount)))
      (try! (contract-call? g pay-gas))
    ))
    (let (
        (after (unwrap-panic (contract-call?
          'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token get-balance
          current-contract
        )))
        (fee (if (> before after)
          (- before after)
          u0
        ))
      )
      ;; Checked BEFORE add-spent-gas, against the pre-fee gas total: the
      ;; question is "does gas-so-far + this fee cross?", which is only right
      ;; while the counter still excludes this fee. A zero fee can never cross,
      ;; so a station that charges nothing is never blocked even on a spent
      ;; fuse.
      ;;
      ;; Reads as the ABORT condition, negated once for asserts! (which
      ;; continues on true): revert only when this call enforces AND the fee
      ;; blows the fuse. GAS-EXEMPT short-circuits the and, so an exempt call
      ;; never reverts here no matter how far over it is -- it still falls
      ;; through to add-spent-gas below and counts.
      (asserts!
        (not (and enforce
          (> (+ (get gas (get-current-spent)) fee) (max-gas-per-period))
        ))
        err-threshold-exceeded
      )
      (add-spent-gas fee)
      (ok true)
    )
  )
)

(define-map whitelisted-extensions
  principal
  bool
)

(define-map pending-operations
  uint
  {
    op-type: (string-ascii 20),
    amount: uint,
    recipient: principal,
    token: (optional principal),
    extension: (optional principal),
    payload: (optional (buff 2048)),
    execute-after: uint,
    executed: bool,
    vetoed: bool,
  }
)

(define-data-var operation-nonce uint u0)

(define-data-var pending-max-gas {
  amount: uint,
  proposed-at: uint,
} {
  amount: u0,
  proposed-at: u0,
})


;; Values committed at SIGNAL time, applied at confirm time.
;;
;; The draft of this version put the values on set-wallet-config, which left the
;; cooldown window useless: an observer saw that a config change was coming and
;; had no way to learn WHAT until it landed, because core's
;; log-signal-config-change carries no arguments. An unactionable warning is not a
;; protection. The values are now public the moment the clock starts, and the
;; passkey confirms exactly what was committed a cooldown earlier -- the same
;; shape as propose-max-gas-amount / confirm-max-gas-amount.
;;
;; Presence is tracked by wallet-config.config-signaled-at and NOT duplicated
;; here: one source of truth for the clock, one for the values.
(define-data-var pending-config {
  stx-threshold: uint,
  sbtc-threshold: uint,
  cooldown-period: uint,
} {
  stx-threshold: u0,
  sbtc-threshold: u0,
  cooldown-period: u0,
})

(define-read-only (get-pending-config)
  (var-get pending-config)
)

(define-read-only (get-pending-max-gas)
  (var-get pending-max-gas)
)

;; Raising max-gas-amount is a two-step under the wallet cooldown.
;;
;; WHY: the <gas-trait> contract is caller-supplied and is NOT bound by the
;; signed hash, so whoever relays a gasless call chooses which gas station gets
;; paid, bounded only by max-gas-amount. The gas path also never consults
;; would-exceed-sbtc-threshold, so it does not queue a pending op. A compromised
;; admin key could therefore raise this instantly and silently, and the next
;; gasless action the user takes would leak up to the new amount to a hostile
;; station -- no phishing and no passkey compromise required, only control of
;; the relay. The cooldown makes the raise visible and delayed instead: the
;; propose fires an alert and the owner has the full period to react.
(define-public (propose-max-gas-amount (amount uint))
  (begin
    (try! (is-admin-calling tx-sender))
    (asserts! (<= amount MAX-GAS-CEILING) err-threshold-exceeded)
    (var-set pending-max-gas {
      amount: amount,
      proposed-at: burn-block-height,
    })
    (update-activity)
    (print { event: "propose-max-gas-amount", amount: amount })
    (ok true)
  )
)

(define-public (confirm-max-gas-amount
    (sig-auth {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    })
    (gas (optional <gas-trait>))
  )
  (let (
      (pending (var-get pending-max-gas))
      (config (var-get wallet-config))
      (wallet-cooldown (get cooldown-period config))
      (effective (if (> wallet-cooldown MAX-CONFIG-COOLDOWN)
        MAX-CONFIG-COOLDOWN
        wallet-cooldown
      ))
    )
    ;; STEP 2 IS THE PASSKEY. propose-max-gas-amount stays admin-only, so raising
    ;; the gas cap now needs both factors across two steps. The hash binds the
    ;; PENDING amount, so a signature collected for a modest raise cannot be
    ;; replayed against a larger proposal swapped in afterwards.
    (try! (is-authorized (some {
      message-hash: (contract-call?
        'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v9
        build-confirm-max-gas-amount-hash {
        auth-id: (get auth-id sig-auth),
        amount: (get amount pending),
      }),
      pubkey: (get pubkey sig-auth),
      signature: (get signature sig-auth),
      authenticator-data: (get authenticator-data sig-auth),
      client-data-prefix: (get client-data-prefix sig-auth),
      client-data-suffix: (get client-data-suffix sig-auth),
    })))
    ;; Standard gas pattern, same reasoning as set-wallet-config.
    ;;
    ;; The fee is metered BEFORE max-gas-amount is updated below, so it is charged
    ;; against the OLD, lower cap and the OLD max-gas-per-period. That is the
    ;; conservative order: a pending raise cannot fund a larger fee on the very
    ;; call that grants it. propose-max-gas-amount takes no gas param, being
    ;; admin-only.
    (match gas
      g (try! (pay-gas-accounted g GAS-ENFORCED))
      true
    )
    (asserts! (not (is-eq (get proposed-at pending) u0)) err-not-signaled)
    (asserts! (>= burn-block-height (+ (get proposed-at pending) effective))
      err-in-cooldown
    )
    (var-set max-gas-amount (get amount pending))
    (var-set pending-max-gas { amount: u0, proposed-at: u0 })
    (update-activity)
    (print { event: "confirm-max-gas-amount", amount: (get amount pending) })
    (ok true)
  )
)

(define-read-only (get-token-lock-enabled)
  (var-get token-lock-enabled)
)

(define-public (toggle-token-lock
    (enabled bool)
    (sig-auth (optional {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    }))
    (gas (optional <gas-trait>))
  )
  (begin
    (asserts! (not (is-eq (var-get owner) 'SP000000000000000000002Q6VF78))
      err-unauthorised
    )
    (if enabled
      (match sig-auth
        sig-auth-details (begin
          (try! (is-authorized (some {
            message-hash: (contract-call?
              'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
              build-toggle-token-lock-hash {
              auth-id: (get auth-id sig-auth-details),
              enabled: enabled,
            }),
            pubkey: (get pubkey sig-auth-details),
            signature: (get signature sig-auth-details),
            authenticator-data: (get authenticator-data sig-auth-details),
            client-data-prefix: (get client-data-prefix sig-auth-details),
            client-data-suffix: (get client-data-suffix sig-auth-details),
          })))
          (match gas
            g (try! (pay-gas-accounted g GAS-ENFORCED))
            true
          )
        )
        (try! (is-authorized none))
      )
      (try! (is-admin-calling tx-sender))
    )
    (var-set token-lock-enabled enabled)
    (update-activity)
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
      log-token-lock-toggled enabled
    ))
    (ok true)
  )
)

(define-public (signal-config-change
    (new-stx-threshold uint)
    (new-sbtc-threshold uint)
    (new-cooldown-period uint)
  )
  (let ((config (var-get wallet-config)))
    (try! (is-authorized none))
    ;; Bounds are checked HERE, at propose time, so an out-of-range value fails
    ;; immediately instead of after a cooldown. Same as propose-max-gas-amount
    ;; asserting MAX-GAS-CEILING at propose rather than at confirm.
    (asserts! (>= new-cooldown-period MIN-COOLDOWN) err-cooldown-too-short)
    (asserts! (<= new-cooldown-period MAX-CONFIG-COOLDOWN) err-cooldown-too-long)
    (var-set pending-config {
      stx-threshold: new-stx-threshold,
      sbtc-threshold: new-sbtc-threshold,
      cooldown-period: new-cooldown-period,
    })
    (var-set wallet-config
      (merge config { config-signaled-at: (some burn-block-height) })
    )
    (update-activity)
    ;; core's log-signal-config-change takes no arguments, so the values are
    ;; printed here. This is what makes the cooldown window inspectable.
    (print {
      event: "signal-config-change",
      stx-threshold: new-stx-threshold,
      sbtc-threshold: new-sbtc-threshold,
      cooldown-period: new-cooldown-period,
      signaled-at: burn-block-height,
    })
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
      log-signal-config-change
    ))
    (ok true)
  )
)

(define-public (set-wallet-config
    (sig-auth {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    })
    (gas (optional <gas-trait>))
  )
  (let (
      (config (var-get wallet-config))
      (pending (var-get pending-config))
      (new-stx-threshold (get stx-threshold pending))
      (new-sbtc-threshold (get sbtc-threshold pending))
      (new-cooldown-period (get cooldown-period pending))
      (signaled-at (default-to u0 (get config-signaled-at config)))
      (wallet-cooldown (get cooldown-period config))
      (effective-config-cooldown (if (> wallet-cooldown MAX-CONFIG-COOLDOWN)
        MAX-CONFIG-COOLDOWN
        wallet-cooldown
      ))
    )
    ;; STEP 2 IS THE PASSKEY, NOT THE ADMIN KEY. In v4 both halves were
    ;; (is-authorized none), so the key that the cooldown protects against could
    ;; also switch the cooldown off. signal-config-change stays admin-only, so
    ;; the two steps now need two DIFFERENT factors: a stolen admin key can start
    ;; a config change and can never finish one.
    ;;
    ;; The hash binds the PENDING values -- the ones committed publicly a cooldown
    ;; ago -- so the passkey approves exactly what was signalled and nothing can be
    ;; substituted at confirm time. Bounds were already asserted at signal.
    (try! (is-authorized (some {
      message-hash: (contract-call?
        'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v9
        build-set-wallet-config-hash {
        auth-id: (get auth-id sig-auth),
        stx-threshold: new-stx-threshold,
        sbtc-threshold: new-sbtc-threshold,
        cooldown-period: new-cooldown-period,
      }),
      pubkey: (get pubkey sig-auth),
      signature: (get signature sig-auth),
      authenticator-data: (get authenticator-data sig-auth),
      client-data-prefix: (get client-data-prefix sig-auth),
      client-data-suffix: (get client-data-suffix sig-auth),
    })))
    ;; Standard gas pattern. This call is passkey-only now, so it is normally
    ;; RELAYED -- without a gas station the owner has to broadcast it themselves
    ;; and pay STX. Placed after the signature check and metered GAS-ENFORCED,
    ;; like every other station-paying site except confirm-transfer-wallet.
    ;;
    ;; signal-config-change deliberately takes NO gas param: it is admin-only, and
    ;; the invariant across both wallets is that a function without sig-auth takes
    ;; no gas either, so a compromised admin key alone can never drain via gas.
    (match gas
      g (try! (pay-gas-accounted g GAS-ENFORCED))
      true
    )
    (asserts! (not (is-eq signaled-at u0)) err-not-signaled)
    (asserts! (>= burn-block-height (+ signaled-at effective-config-cooldown))
      err-in-cooldown
    )
    (var-set wallet-config {
      stx-threshold: new-stx-threshold,
      sbtc-threshold: new-sbtc-threshold,
      cooldown-period: new-cooldown-period,
      config-signaled-at: none,
    })
    ;; Clear the queue, same as confirm-max-gas-amount clears pending-max-gas.
    ;; Two reasons. get-pending-config would otherwise keep reporting the values
    ;; of a change that has already landed, so any UI reading it alone shows a
    ;; phantom pending change. And all-zeros becomes an unambiguous "nothing
    ;; queued", so a reader does not have to consult config-signaled-at to know.
    (var-set pending-config {
      stx-threshold: u0,
      sbtc-threshold: u0,
      cooldown-period: u0,
    })
    (update-activity)
    (print {
      event: "set-wallet-config",
      stx-threshold: new-stx-threshold,
      sbtc-threshold: new-sbtc-threshold,
      cooldown-period: new-cooldown-period,
    })
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
      log-wallet-config-set new-stx-threshold new-sbtc-threshold u0
      new-cooldown-period
    ))
    (ok true)
  )
)

(define-private (create-pending-operation
    (op-type (string-ascii 20))
    (amount uint)
    (recipient principal)
    (token (optional principal))
    (extension (optional principal))
    (payload (optional (buff 2048)))
  )
  (let (
      (config (var-get wallet-config))
      (op-id (var-get operation-nonce))
    )
    (map-set pending-operations op-id {
      op-type: op-type,
      amount: amount,
      recipient: recipient,
      token: token,
      extension: extension,
      payload: payload,
      execute-after: (+ burn-block-height (get cooldown-period config)),
      executed: false,
      vetoed: false,
    })
    (var-set operation-nonce (+ op-id u1))
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
      log-pending-operation op-id op-type amount recipient token extension
      payload (+ burn-block-height (get cooldown-period config))
    ))
    (ok op-id)
  )
)

(define-public (veto-operation
    (op-id uint)
    (sig-auth (optional {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    }))
    (gas (optional <gas-trait>))
  )
  (let ((op (unwrap! (map-get? pending-operations op-id) err-invalid-operation)))
    (match sig-auth
      sig-auth-details (begin
        (try! (is-authorized (some {
          message-hash: (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
            build-veto-operation-hash {
            auth-id: (get auth-id sig-auth-details),
            op-id: op-id,
          }),
          pubkey: (get pubkey sig-auth-details),
          signature: (get signature sig-auth-details),
          authenticator-data: (get authenticator-data sig-auth-details),
          client-data-prefix: (get client-data-prefix sig-auth-details),
          client-data-suffix: (get client-data-suffix sig-auth-details),
        })))
        (match gas
          g (try! (pay-gas-accounted g GAS-ENFORCED))
          true
        )
      )
      (try! (is-authorized none))
    )
    (asserts! (not (get executed op)) err-already-executed)
    (map-set pending-operations op-id (merge op { vetoed: true }))
    ;; Vetoing is the owner actively defending the wallet. Omitting this meant an
    ;; owner whose only interaction across a year was killing hostile pending ops
    ;; counted as ABANDONED, and the recovery address could seize the wallet from
    ;; someone demonstrably present. Inherited from v4; 21 of 25 public functions
    ;; already did this, and the docs claim all of them do.
    (update-activity)
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
      log-operation-vetoed op-id
    ))
    (ok true)
  )
)

(define-read-only (get-pending-operation (op-id uint))
  (map-get? pending-operations op-id)
)

(define-private (would-exceed-stx-threshold (amount uint))
  (let (
      (config (var-get wallet-config))
      (spent (get-current-spent))
    )
    (> (+ (get stx spent) amount) (get stx-threshold config))
  )
)

(define-private (would-exceed-sbtc-threshold (amount uint))
  (let (
      (config (var-get wallet-config))
      (spent (get-current-spent))
    )
    (> (+ (get sbtc spent) amount) (get sbtc-threshold config))
  )
)

(define-private (is-authorized (sig-message-auth (optional {
  message-hash: (buff 32),
  pubkey: (buff 33),
  signature: (buff 64),
  authenticator-data: (buff 256),
  client-data-prefix: (buff 128),
  client-data-suffix: (buff 512),
})))
  (match sig-message-auth
    sig-message-details (consume-signature (get message-hash sig-message-details)
      (get pubkey sig-message-details) (get signature sig-message-details)
      (get authenticator-data sig-message-details)
      (get client-data-prefix sig-message-details)
      (get client-data-suffix sig-message-details)
    )
    (is-admin-calling tx-sender)
  )
)

(define-read-only (is-admin-calling (caller principal))
  (ok (asserts! (is-some (map-get? admins caller)) err-unauthorised))
)

(define-public (whitelist-extension (extension principal))
  (begin
    (try! (is-admin-calling tx-sender))
    (create-pending-operation "whitelist-ext" u0 extension none (some extension)
      none
    )
  )
)

(define-public (execute-pending-whitelist
    (op-id uint)
    (sig-auth {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    })
    (gas (optional <gas-trait>))
  )
  (let ((op (unwrap! (map-get? pending-operations op-id) err-invalid-operation)))
    (asserts! (is-eq (get op-type op) "whitelist-ext") err-invalid-operation)
    (asserts! (not (get executed op)) err-already-executed)
    (asserts! (not (get vetoed op)) err-vetoed)
    (asserts! (>= burn-block-height (get execute-after op))
      err-cooldown-not-passed
    )
    (try! (is-authorized (some {
      message-hash: (contract-call?
        'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
        build-whitelist-extension-hash {
        auth-id: (get auth-id sig-auth),
        op-id: op-id,
        extension: (unwrap! (get extension op) err-invalid-operation),
      }),
      pubkey: (get pubkey sig-auth),
      signature: (get signature sig-auth),
      authenticator-data: (get authenticator-data sig-auth),
      client-data-prefix: (get client-data-prefix sig-auth),
      client-data-suffix: (get client-data-suffix sig-auth),
    })))
    (match gas
      g (try! (pay-gas-accounted g GAS-ENFORCED))
      true
    )
    (map-set pending-operations op-id (merge op { executed: true }))
    (map-set whitelisted-extensions
      (unwrap! (get extension op) err-invalid-operation) true
    )
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
      log-extension-whitelisted (unwrap-panic (get extension op))
    ))
    (ok true)
  )
)

(define-public (remove-extension-whitelist
    (extension principal)
    (sig-auth (optional {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    }))
    (gas (optional <gas-trait>))
  )
  (begin
    (match sig-auth
      sig-auth-details (begin
        (try! (is-authorized (some {
          message-hash: (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
            build-remove-extension-whitelist-hash {
            auth-id: (get auth-id sig-auth-details),
            extension: extension,
          }),
          pubkey: (get pubkey sig-auth-details),
          signature: (get signature sig-auth-details),
          authenticator-data: (get authenticator-data sig-auth-details),
          client-data-prefix: (get client-data-prefix sig-auth-details),
          client-data-suffix: (get client-data-suffix sig-auth-details),
        })))
        (match gas
          g (try! (pay-gas-accounted g GAS-ENFORCED))
          true
        )
      )
      (try! (is-authorized none))
    )
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
      log-extension-removed extension
    ))
    (ok (map-delete whitelisted-extensions extension))
  )
)

(define-read-only (is-extension-whitelisted (extension principal))
  (default-to false (map-get? whitelisted-extensions extension))
)

(define-public (stx-transfer
    (amount uint)
    (recipient principal)
    (memo (optional (buff 34)))
    (sig-auth (optional {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    }))
    (gas (optional <gas-trait>))
  )
  (begin
    (update-activity)
    (match sig-auth
      sig-auth-details (begin
        (asserts! (not (var-get token-lock-enabled)) err-token-locked)
        (try! (is-authorized (some {
          message-hash: (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
            build-stx-transfer-hash {
            auth-id: (get auth-id sig-auth-details),
            amount: amount,
            recipient: recipient,
            memo: memo,
          }),
          pubkey: (get pubkey sig-auth-details),
          signature: (get signature sig-auth-details),
          authenticator-data: (get authenticator-data sig-auth-details),
          client-data-prefix: (get client-data-prefix sig-auth-details),
          client-data-suffix: (get client-data-suffix sig-auth-details),
        })))
        (match gas
          g (try! (pay-gas-accounted g GAS-ENFORCED))
          true
        )
      )
      (try! (is-authorized none))
    )
    (if (would-exceed-stx-threshold amount)
      (begin
        (unwrap-panic (create-pending-operation "stx-transfer" amount recipient none none none))
        (ok true)
      )
      (begin
        (add-spent-stx amount)
        (try! (contract-call?
          'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
          log-stx-transfer amount recipient memo
        ))
        (as-contract? ((with-stx amount))
          (match memo
            to-print (try! (stx-transfer-memo? amount tx-sender recipient to-print))
            (try! (stx-transfer? amount tx-sender recipient))
          ))
      )
    )
  )
)

(define-public (execute-pending-stx-transfer
    (op-id uint)
    (memo (optional (buff 34)))
  )
  (let ((op (unwrap! (map-get? pending-operations op-id) err-invalid-operation)))
    (asserts! (is-eq (get op-type op) "stx-transfer") err-invalid-operation)
    (asserts! (not (get executed op)) err-already-executed)
    (asserts! (not (get vetoed op)) err-vetoed)
    (asserts! (>= burn-block-height (get execute-after op))
      err-cooldown-not-passed
    )
    (try! (is-authorized none))
    (map-set pending-operations op-id (merge op { executed: true }))
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
      log-stx-transfer (get amount op) (get recipient op) memo
    ))
    (as-contract? ((with-stx (get amount op)))
      (match memo
        to-print (try! (stx-transfer-memo? (get amount op) tx-sender (get recipient op) to-print))
        (try! (stx-transfer? (get amount op) tx-sender (get recipient op)))
      ))
  )
)

(define-public (extension-call
    (extension <extension-trait>)
    (payload (buff 2048))
    (sig-auth (optional {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    }))
    (gas (optional <gas-trait>))
  )
  (begin
    (update-activity)
    (asserts! (is-extension-whitelisted (contract-of extension))
      err-not-whitelisted
    )
    (match sig-auth
      sig-auth-details (begin
        (asserts! (not (var-get token-lock-enabled)) err-token-locked)
        (try! (is-authorized (some {
          message-hash: (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
            build-extension-call-hash {
            auth-id: (get auth-id sig-auth-details),
            extension: (contract-of extension),
            payload: payload,
          }),
          pubkey: (get pubkey sig-auth-details),
          signature: (get signature sig-auth-details),
          authenticator-data: (get authenticator-data sig-auth-details),
          client-data-prefix: (get client-data-prefix sig-auth-details),
          client-data-suffix: (get client-data-suffix sig-auth-details),
        })))
        (match gas
          g (try! (pay-gas-accounted g GAS-ENFORCED))
          true
        )
      )
      (try! (is-authorized none))
    )
    (try! (ft-mint? ect u1 current-contract))
    (try! (ft-burn? ect u1 current-contract))
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
      log-extension-call (contract-of extension) payload
    ))
    (as-contract? ((with-all-assets-unsafe))
      (try! (contract-call? extension call payload))
    )
  )
)

(define-public (sip010-transfer
    (amount uint)
    (recipient principal)
    (memo (optional (buff 34)))
    (sip010 <sip-010-trait>)
    (token-name (string-ascii 128))
    (sig-auth (optional {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    }))
    (gas (optional <gas-trait>))
  )
  (begin
    (update-activity)
    (match sig-auth
      sig-auth-details (begin
        (asserts! (not (var-get token-lock-enabled)) err-token-locked)
        (try! (is-authorized (some {
          message-hash: (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
            build-sip010-transfer-hash {
            auth-id: (get auth-id sig-auth-details),
            amount: amount,
            recipient: recipient,
            memo: memo,
            sip010: (contract-of sip010),
          }),
          pubkey: (get pubkey sig-auth-details),
          signature: (get signature sig-auth-details),
          authenticator-data: (get authenticator-data sig-auth-details),
          client-data-prefix: (get client-data-prefix sig-auth-details),
          client-data-suffix: (get client-data-suffix sig-auth-details),
        })))
        (match gas
          g (try! (pay-gas-accounted g GAS-ENFORCED))
          true
        )
      )
      (try! (is-authorized none))
    )
    (if (and (is-eq (contract-of sip010) SBTC-CONTRACT) (would-exceed-sbtc-threshold amount))
      (begin
        (unwrap-panic (create-pending-operation "sbtc-transfer" amount recipient
          (some SBTC-CONTRACT) none none
        ))
        (ok true)
      )
      (begin
        (if (is-eq (contract-of sip010) SBTC-CONTRACT)
          (add-spent-sbtc amount)
          true
        )
        (try! (contract-call?
          'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
          log-sip010-transfer (contract-of sip010) amount recipient memo
        ))
        (as-contract? ((with-ft (contract-of sip010) token-name amount))
          (try! (contract-call? sip010 transfer amount current-contract recipient memo))
        )
      )
    )
  )
)

(define-public (execute-pending-sbtc-transfer
    (op-id uint)
    (memo (optional (buff 34)))
  )
  (let ((op (unwrap! (map-get? pending-operations op-id) err-invalid-operation)))
    (asserts! (is-eq (get op-type op) "sbtc-transfer") err-invalid-operation)
    (asserts! (not (get executed op)) err-already-executed)
    (asserts! (not (get vetoed op)) err-vetoed)
    (asserts! (>= burn-block-height (get execute-after op))
      err-cooldown-not-passed
    )
    (try! (is-authorized none))
    (map-set pending-operations op-id (merge op { executed: true }))
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
      log-sip010-transfer SBTC-CONTRACT (get amount op) (get recipient op)
      memo
    ))
    (as-contract? ((with-ft SBTC-CONTRACT "sbtc-token" (get amount op)))
      (try! (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
        transfer (get amount op) current-contract (get recipient op) memo
      ))
    )
  )
)

(define-public (sbtc-initiate-withdrawal
    (amount uint)
    (recipient {
      version: (buff 1),
      hashbytes: (buff 32),
    })
    (max-fee uint)
    (sig-auth (optional {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    }))
    (gas (optional <gas-trait>))
  )
  (begin
    (update-activity)
    (match sig-auth
      sig-auth-details (begin
        (asserts! (not (var-get token-lock-enabled)) err-token-locked)
        (try! (is-authorized (some {
          message-hash: (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v8
            build-sbtc-withdrawal-hash {
            auth-id: (get auth-id sig-auth-details),
            amount: amount,
            recipient: recipient,
            max-fee: max-fee,
          }),
          pubkey: (get pubkey sig-auth-details),
          signature: (get signature sig-auth-details),
          authenticator-data: (get authenticator-data sig-auth-details),
          client-data-prefix: (get client-data-prefix sig-auth-details),
          client-data-suffix: (get client-data-suffix sig-auth-details),
        })))
        (match gas
          g (try! (pay-gas-accounted g GAS-ENFORCED))
          true
        )
      )
      (try! (is-authorized none))
    )
    (if (would-exceed-sbtc-threshold (+ amount max-fee))
      (begin
        (unwrap-panic (create-pending-operation "sbtc-withdraw" amount
          current-contract (some SBTC-CONTRACT) none
          (some (unwrap-panic (to-consensus-buff? {
            recipient: recipient,
            max-fee: max-fee,
          })))
        ))
        (ok true)
      )
      (begin
        (add-spent-sbtc (+ amount max-fee))
        (try! (as-contract? ((with-ft SBTC-CONTRACT "sbtc-token" (+ amount max-fee)))
          (try! (contract-call?
            'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal
            initiate-withdrawal-request amount recipient max-fee
          ))
        ))
        (ok true)
      )
    )
  )
)

(define-public (execute-pending-sbtc-withdrawal (op-id uint))
  (let ((op (unwrap! (map-get? pending-operations op-id) err-invalid-operation)))
    (asserts! (is-eq (get op-type op) "sbtc-withdraw") err-invalid-operation)
    (asserts! (not (get executed op)) err-already-executed)
    (asserts! (not (get vetoed op)) err-vetoed)
    (asserts! (>= burn-block-height (get execute-after op))
      err-cooldown-not-passed
    )
    (try! (is-authorized none))
    (let (
        (raw (unwrap! (get payload op) err-invalid-operation))
        (parsed (unwrap!
          (from-consensus-buff?
            {
              recipient: { version: (buff 1), hashbytes: (buff 32) },
              max-fee: uint,
            }
            raw
          )
          err-invalid-operation
        ))
        (the-recipient (get recipient parsed))
        (the-max-fee (get max-fee parsed))
        (the-amount (get amount op))
        (lock-total (+ the-amount the-max-fee))
      )
      (map-set pending-operations op-id (merge op { executed: true }))
      (as-contract? ((with-ft SBTC-CONTRACT "sbtc-token" lock-total))
        (try! (contract-call?
          'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal
          initiate-withdrawal-request the-amount the-recipient the-max-fee
        ))
      )
    )
  )
)

(define-public (sip009-transfer
    (nft-id uint)
    (recipient principal)
    (sip009 <sip-009-trait>)
    (token-name (string-ascii 128))
    (sig-auth (optional {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    }))
    (gas (optional <gas-trait>))
  )
  (begin
    (update-activity)
    (match sig-auth
      sig-auth-details (begin
        (asserts! (not (var-get token-lock-enabled)) err-token-locked)
        (try! (is-authorized (some {
          message-hash: (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
            build-sip009-transfer-hash {
            auth-id: (get auth-id sig-auth-details),
            nft-id: nft-id,
            recipient: recipient,
            sip009: (contract-of sip009),
          }),
          pubkey: (get pubkey sig-auth-details),
          signature: (get signature sig-auth-details),
          authenticator-data: (get authenticator-data sig-auth-details),
          client-data-prefix: (get client-data-prefix sig-auth-details),
          client-data-suffix: (get client-data-suffix sig-auth-details),
        })))
        (match gas
          g (try! (pay-gas-accounted g GAS-ENFORCED))
          true
        )
      )
      (try! (is-authorized none))
    )
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
      log-sip009-transfer nft-id recipient (contract-of sip009)
    ))
    (as-contract? ((with-nft (contract-of sip009) token-name (list nft-id)))
      (try! (contract-call? sip009 transfer nft-id current-contract recipient))
    )
  )
)

(define-public (faktory-execute
    (pool <pool-trait>)
    (amount uint)
    (opcode (optional (buff 16)))
    (sip010 <sip-010-trait>)
    (sip010-name (string-ascii 128))
    (sig-auth (optional {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    }))
    (gas (optional <gas-trait>))
  )
  (begin
    (update-activity)
    (match sig-auth
      sig-auth-details (begin
        (try! (is-authorized (some {
          message-hash: (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
            build-faktory-execute-hash {
            auth-id: (get auth-id sig-auth-details),
            pool: (contract-of pool),
            amount: amount,
            opcode: opcode,
          }),
          pubkey: (get pubkey sig-auth-details),
          signature: (get signature sig-auth-details),
          authenticator-data: (get authenticator-data sig-auth-details),
          client-data-prefix: (get client-data-prefix sig-auth-details),
          client-data-suffix: (get client-data-suffix sig-auth-details),
        })))
        (match gas
          g (try! (pay-gas-accounted g GAS-ENFORCED))
          true
        )
      )
      (try! (is-authorized none))
    )
    (let ((op (get-byte (default-to 0x00 opcode) u0)))
      (if (or
          (is-eq op EXECUTE-OP-BUY)
          (is-eq op EXECUTE-OP-SELL)
          (is-eq op EXECUTE-OP-REMOVE-LIQ)
        )
        (as-contract? ((with-ft (contract-of sip010) sip010-name amount))
          (try! (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-core-v2 execute
            pool amount opcode
          ))
        )
        (if (is-eq op EXECUTE-OP-ADD-LIQ)
          (let ((liq-quote (unwrap! (contract-call? pool quote amount (some 0x02))
              err-invalid-operation
            )))
            (as-contract?
              (
                (with-ft SBTC-CONTRACT "sbtc-token" (get dx liq-quote))
                (with-ft (contract-of sip010) sip010-name (get dy liq-quote))
              )
              (try! (contract-call?
                'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-core-v2
                execute pool amount opcode
              ))
            )
          )
          err-invalid-operation
        )
      )
    )
  )
)

(define-private (get-byte
    (opcode (buff 16))
    (position uint)
  )
  (default-to 0x00 (element-at? opcode position))
)

(define-public (faktory-execute-limit
    (pool <pool-trait>)
    (amount uint)
    (opcode (optional (buff 16)))
    (sip010 <sip-010-trait>)
    (sip010-name (string-ascii 128))
    (limit-out uint)
    (expiry-burn-block uint)
    (sig-auth {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    })
    (gas (optional <gas-trait>))
  )
  (begin
    (update-activity)
    (asserts! (not (var-get token-lock-enabled)) err-token-locked)
    (asserts! (<= burn-block-height expiry-burn-block) err-limit-expired)
    (try! (is-authorized (some {
      message-hash: (contract-call?
        'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
        build-faktory-execute-limit-hash {
        auth-id: (get auth-id sig-auth),
        pool: (contract-of pool),
        amount: amount,
        opcode: opcode,
        limit-out: limit-out,
        expiry-burn-block: expiry-burn-block,
      }),
      pubkey: (get pubkey sig-auth),
      signature: (get signature sig-auth),
      authenticator-data: (get authenticator-data sig-auth),
      client-data-prefix: (get client-data-prefix sig-auth),
      client-data-suffix: (get client-data-suffix sig-auth),
    })))
    (match gas
      g (try! (pay-gas-accounted g GAS-ENFORCED))
      true
    )
    (let ((op (get-byte (default-to 0x00 opcode) u0)))
      (if (or (is-eq op EXECUTE-OP-BUY) (is-eq op EXECUTE-OP-SELL))
        (let ((result (try! (as-contract? ((with-ft (contract-of sip010) sip010-name amount))
            (try! (contract-call?
              'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-core-v2 execute
              pool amount opcode
            ))
          ))))
          (asserts! (>= (get dy result) limit-out) err-limit-not-hit)
          (ok result)
        )
        err-invalid-operation
      )
    )
  )
)

(define-public (faktory-place-order
    (dex <dex-trait>)
    (token <token-trait>)
    (token-name (string-ascii 128))
    (amount uint)
    (opcode (optional (buff 16)))
    (sig-auth (optional {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    }))
    (gas (optional <gas-trait>))
  )
  (begin
    (update-activity)
    (match sig-auth
      sig-auth-details (begin
        (try! (is-authorized (some {
          message-hash: (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
            build-faktory-place-order-hash {
            auth-id: (get auth-id sig-auth-details),
            dex: (contract-of dex),
            amount: amount,
            opcode: opcode,
          }),
          pubkey: (get pubkey sig-auth-details),
          signature: (get signature sig-auth-details),
          authenticator-data: (get authenticator-data sig-auth-details),
          client-data-prefix: (get client-data-prefix sig-auth-details),
          client-data-suffix: (get client-data-suffix sig-auth-details),
        })))
        (match gas
          g (try! (pay-gas-accounted g GAS-ENFORCED))
          true
        )
      )
      (try! (is-authorized none))
    )
    (let ((op (get-byte (default-to 0x00 opcode) u0)))
      (if (is-eq op OPCODE-BUY)
        (as-contract? ((with-ft SBTC-CONTRACT "sbtc-token" amount))
          (try! (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-core-v2
            place-order dex token amount opcode
          ))
        )
        (if (is-eq op OPCODE-SELL)
          (as-contract? ((with-ft (contract-of token) token-name amount))
            (try! (contract-call?
              'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-core-v2
              place-order dex token amount opcode
            ))
          )
          err-invalid-operation
        )
      )
    )
  )
)

(define-public (faktory-process
    (pre <pre-trait>)
    (seat-count uint)
    (opcode (optional (buff 16)))
    (sig-auth (optional {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    }))
    (gas (optional <gas-trait>))
  )
  (begin
    (update-activity)
    (match sig-auth
      sig-auth-details (begin
        (try! (is-authorized (some {
          message-hash: (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
            build-faktory-process-hash {
            auth-id: (get auth-id sig-auth-details),
            pre: (contract-of pre),
            seat-count: seat-count,
            opcode: opcode,
          }),
          pubkey: (get pubkey sig-auth-details),
          signature: (get signature sig-auth-details),
          authenticator-data: (get authenticator-data sig-auth-details),
          client-data-prefix: (get client-data-prefix sig-auth-details),
          client-data-suffix: (get client-data-suffix sig-auth-details),
        })))
        (match gas
          g (try! (pay-gas-accounted g GAS-ENFORCED))
          true
        )
      )
      (try! (is-authorized none))
    )
    (let ((operation (get-byte (default-to 0x02 opcode) u0)))
      (if (is-eq operation OPCODE-BUY-SEATS)
        (let ((seat-price (try! (contract-call? pre get-seat-price))))
          (as-contract?
            ((with-ft SBTC-CONTRACT "sbtc-token" (* seat-count seat-price)))
            (try! (contract-call?
              'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-core-v2 process
              pre seat-count (some current-contract) opcode
            ))
          )
        )
        (if (is-eq operation OPCODE-REFUND)
          (as-contract? ()
            (try! (contract-call?
              'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-core-v2 process
              pre seat-count (some current-contract) opcode
            ))
          )
          err-invalid-operation
        )
      )
    )
  )
)

(define-public (faktory-process-claim
    (pre <pre-trait>)
    (token <token-trait>)
    (sig-auth (optional {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    }))
    (gas (optional <gas-trait>))
  )
  (begin
    (update-activity)
    (match sig-auth
      sig-auth-details (begin
        (try! (is-authorized (some {
          message-hash: (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
            build-faktory-process-claim-hash {
            auth-id: (get auth-id sig-auth-details),
            pre: (contract-of pre),
          }),
          pubkey: (get pubkey sig-auth-details),
          signature: (get signature sig-auth-details),
          authenticator-data: (get authenticator-data sig-auth-details),
          client-data-prefix: (get client-data-prefix sig-auth-details),
          client-data-suffix: (get client-data-suffix sig-auth-details),
        })))
        (match gas
          g (try! (pay-gas-accounted g GAS-ENFORCED))
          true
        )
      )
      (try! (is-authorized none))
    )
    (as-contract? ()
      (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-core-v2
        process-claim pre token (some current-contract)
      ))
    )
  )
)

(define-public (faktory-fee-airdrop
    (pre <pre-trait>)
    (sig-auth (optional {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    }))
    (gas (optional <gas-trait>))
  )
  (begin
    (update-activity)
    (match sig-auth
      sig-auth-details (begin
        (try! (is-authorized (some {
          message-hash: (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
            build-faktory-fee-airdrop-hash {
            auth-id: (get auth-id sig-auth-details),
            pre: (contract-of pre),
          }),
          pubkey: (get pubkey sig-auth-details),
          signature: (get signature sig-auth-details),
          authenticator-data: (get authenticator-data sig-auth-details),
          client-data-prefix: (get client-data-prefix sig-auth-details),
          client-data-suffix: (get client-data-suffix sig-auth-details),
        })))
        (match gas
          g (try! (pay-gas-accounted g GAS-ENFORCED))
          true
        )
      )
      (try! (is-authorized none))
    )
    (as-contract? ()
      (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-core-v2
        process-fee-airdrop pre
      ))
    )
  )
)

(define-public (faktory-burn-bob
    (sig-auth (optional {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    }))
    (gas (optional <gas-trait>))
  )
  (begin
    (update-activity)
    (match sig-auth
      sig-auth-details (begin
        (try! (is-authorized (some {
          message-hash: (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
            build-faktory-burn-bob-hash { auth-id: (get auth-id sig-auth-details) }
          ),
          pubkey: (get pubkey sig-auth-details),
          signature: (get signature sig-auth-details),
          authenticator-data: (get authenticator-data sig-auth-details),
          client-data-prefix: (get client-data-prefix sig-auth-details),
          client-data-suffix: (get client-data-suffix sig-auth-details),
        })))
        (match gas
          g (try! (pay-gas-accounted g GAS-ENFORCED))
          true
        )
      )
      (try! (is-authorized none))
    )
    (as-contract? ((with-ft BOB-CONTRACT "BOB" BOB-BURN-AMOUNT))
      (try! (contract-call? 'SP29D6YMDNAKN1P045T6Z817RTE1AC0JAA99WAX2B.burn-bob-faktory
        daily-burn
      ))
    )
  )
)

(define-public (faktory-nft-execute
    (marketplace <nftmarket-trait>)
    (token-id uint)
    (nft-contract <sip-009-trait>)
    (nft-name (string-ascii 128))
    (ft-contract <sip-010-trait>)
    (ft-name (string-ascii 128))
    (price uint)
    (opcode (optional (buff 16)))
    (sig-auth (optional {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    }))
    (gas (optional <gas-trait>))
  )
  (begin
    (update-activity)
    (match sig-auth
      sig-auth-details (begin
        (try! (is-authorized (some {
          message-hash: (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
            build-faktory-nft-execute-hash {
            auth-id: (get auth-id sig-auth-details),
            marketplace: (contract-of marketplace),
            token-id: token-id,
            ft-contract: (contract-of ft-contract),
            price: price,
            opcode: opcode,
          }),
          pubkey: (get pubkey sig-auth-details),
          signature: (get signature sig-auth-details),
          authenticator-data: (get authenticator-data sig-auth-details),
          client-data-prefix: (get client-data-prefix sig-auth-details),
          client-data-suffix: (get client-data-suffix sig-auth-details),
        })))
        (match gas
          g (try! (pay-gas-accounted g GAS-ENFORCED))
          true
        )
      )
      (try! (is-authorized none))
    )
    (let ((op (get-byte (default-to 0x00 opcode) u0)))
      (if (is-eq op NFT-OP-LIST)
        (as-contract?
          ((with-nft (contract-of nft-contract) nft-name (list token-id)))
          (try! (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-nfts-core
            list-nft marketplace token-id nft-contract ft-contract price
          ))
        )
        (if (is-eq op NFT-OP-BUY)
          (as-contract? ((with-ft (contract-of ft-contract) ft-name price))
            (try! (contract-call?
              'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-nfts-core
              buy-nft marketplace token-id nft-contract ft-contract
            ))
          )
          (if (is-eq op NFT-OP-UNLIST)
            (as-contract? ()
              (try! (contract-call?
                'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-nfts-core
                unlist-nft marketplace token-id nft-contract
              ))
            )
            (if (is-eq op NFT-OP-UPDATE-PRICE)
              (as-contract? ()
                (try! (contract-call?
                  'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-nfts-core
                  update-price marketplace token-id price
                ))
              )
              (if (is-eq op NFT-OP-UPDATE-FT)
                (as-contract? ()
                  (try! (contract-call?
                    'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-nfts-core
                    update-listing-ft marketplace token-id ft-contract price
                  ))
                )
                err-invalid-operation
              )
            )
          )
        )
      )
    )
  )
)

(define-map admins
  principal
  bool
)

(define-map pubkey-to-admin
  (buff 33)
  principal
)

(define-read-only (is-admin-pubkey (pubkey (buff 33)))
  (let ((user-opt (map-get? pubkey-to-admin pubkey)))
    (match user-opt
      user (ok (unwrap! (is-admin-calling user) err-not-admin-pubkey))
      err-unregistered-pubkey
    )
  )
)

(define-public (propose-transfer-wallet (new-admin principal))
  (begin
    (try! (is-admin-calling tx-sender))
    (asserts! (not (is-eq new-admin tx-sender)) err-forbidden)
    (var-set pending-transfer new-admin)
    (update-activity)
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
      log-propose-transfer-wallet new-admin
    ))
    (ok true)
  )
)

(define-public (confirm-transfer-wallet
    (sig-auth {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    })
    (gas (optional <gas-trait>))
  )
  (let ((pending (var-get pending-transfer)))
    (asserts! (not (is-eq pending 'SP000000000000000000002Q6VF78))
      err-no-pending-transfer
    )
    (try! (is-authorized (some {
      message-hash: (contract-call?
        'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
        build-confirm-transfer-hash {
        auth-id: (get auth-id sig-auth),
        new-admin: pending,
      }),
      pubkey: (get pubkey sig-auth),
      signature: (get signature sig-auth),
      authenticator-data: (get authenticator-data sig-auth),
      client-data-prefix: (get client-data-prefix sig-auth),
      client-data-suffix: (get client-data-suffix sig-auth),
    })))
    (match gas
      g (try! (pay-gas-accounted g GAS-EXEMPT))
      true
    )
    (try! (ft-mint? ect u1 current-contract))
    (try! (ft-burn? ect u1 current-contract))
    ;; NEVER this contract. as-contract? rebinds tx-sender to this contract,
    ;; so seating it here would let any caller-supplied gas station re-enter
    ;; with sig-auth none and pass is-admin-calling. Clarity's principal
    ;; type does not distinguish a standard principal from a contract one.
    (asserts! (not (is-eq pending current-contract)) err-unauthorised)
    (map-set admins pending true)
    (map-delete admins (var-get owner))
    (var-set owner pending)
    (var-set pending-transfer 'SP000000000000000000002Q6VF78)
    (update-activity)
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
      log-wallet-transferred pending
    ))
    (ok true)
  )
)

;; remove-admin-pubkey intentionally OMITTED (v8): an admin key alone must
;; never be able to de-authorize a passkey. Instant admin-only removal let a
;; compromised admin key strip the owner's passkey and destroy the
;; passkey-confirmed transfer escape (propose-transfer-wallet +
;; confirm-transfer-wallet, 2FA). Rotate a passkey by transferring ownership
;; (which resets the admins map) instead.

(define-read-only (verify-signature
    (message-hash (buff 32))
    (pubkey (buff 33))
    (signature (buff 64))
    (authenticator-data (buff 256))
    (client-data-prefix (buff 128))
    (client-data-suffix (buff 512))
  )
  (let ((auth-rp-id (unwrap!
      (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.clarity-5-webauthn-v3
        get-rp-id-hash authenticator-data
      )
      err-invalid-signature
    )))
    (try! (is-admin-pubkey pubkey))
    (asserts!
      (or
        (is-eq auth-rp-id RP-ID-HASH-FAKFUN-COM)
        (is-eq auth-rp-id RP-ID-HASH-FAK-FUN)
      )
      err-invalid-signature
    )
    (asserts!
      (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.clarity-5-webauthn-v3
        is-user-verified authenticator-data
      )
      err-invalid-signature
    )
    (ok (asserts!
      (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.clarity-5-webauthn-v3
        verify-webauthn-signature pubkey message-hash authenticator-data
        client-data-prefix client-data-suffix signature
      )
      err-invalid-signature
    ))
  )
)

(define-private (consume-signature
    (message-hash (buff 32))
    (pubkey (buff 33))
    (signature (buff 64))
    (authenticator-data (buff 256))
    (client-data-prefix (buff 128))
    (client-data-suffix (buff 512))
  )
  (begin
    (try! (verify-signature message-hash pubkey signature authenticator-data
      client-data-prefix client-data-suffix
    ))
    (asserts! (is-none (map-get? used-pubkey-authorizations message-hash))
      err-signature-replay
    )
    (map-set used-pubkey-authorizations message-hash pubkey)
    (ok true)
  )
)

(define-read-only (get-owner)
  (ok (var-get owner))
)

(define-read-only (is-inactive)
  (> burn-block-height (+ INACTIVITY-PERIOD (var-get last-activity-block)))
)

(define-private (update-activity)
  (var-set last-activity-block burn-block-height)
)

(define-public (propose-admin-with-signature
    (new-admin principal)
    (sig-auth {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    })
    (gas (optional <gas-trait>))
  )
  (begin
    (asserts! (not (var-get is-initialized)) err-already-initialized)
    (asserts! (is-eq (get proposed-at (var-get pending-init-admin)) u0)
      err-init-already-proposed
    )
    (try! (is-authorized (some {
      message-hash: (contract-call?
        'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
        build-add-admin-hash {
        auth-id: (get auth-id sig-auth),
        new-admin: new-admin,
      }),
      pubkey: (get pubkey sig-auth),
      signature: (get signature sig-auth),
      authenticator-data: (get authenticator-data sig-auth),
      client-data-prefix: (get client-data-prefix sig-auth),
      client-data-suffix: (get client-data-suffix sig-auth),
    })))
    (match gas
      g (try! (pay-gas-accounted g GAS-ENFORCED))
      true
    )
    (var-set pending-init-admin {
      new-admin: new-admin,
      proposed-at: burn-block-height,
      accepted: false,
    })
    (ok true)
  )
)

(define-public (accept-admin-proposal)
  (let ((pending (var-get pending-init-admin)))
    (asserts! (not (var-get is-initialized)) err-already-initialized)
    (asserts! (not (is-eq (get proposed-at pending) u0)) err-no-pending-init)
    (asserts! (is-eq tx-sender (get new-admin pending))
      err-init-not-pending-admin
    )
    (var-set pending-init-admin (merge pending { accepted: true }))
    (ok true)
  )
)

(define-public (confirm-admin-with-signature
    (sig-auth {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    })
    (gas (optional <gas-trait>))
  )
  (let (
      (pending (var-get pending-init-admin))
      (new-a (get new-admin pending))
    )
    (asserts! (not (var-get is-initialized)) err-already-initialized)
    (asserts! (not (is-eq (get proposed-at pending) u0)) err-no-pending-init)
    (asserts! (get accepted pending) err-init-not-accepted)
    (asserts!
      (>= burn-block-height
        (+ (get proposed-at pending) (var-get pubkey-cooldown-period))
      )
      err-in-cooldown
    )
    (try! (is-authorized (some {
      message-hash: (contract-call?
        'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
        build-confirm-admin-hash {
        auth-id: (get auth-id sig-auth),
        new-admin: new-a,
      }),
      pubkey: (get pubkey sig-auth),
      signature: (get signature sig-auth),
      authenticator-data: (get authenticator-data sig-auth),
      client-data-prefix: (get client-data-prefix sig-auth),
      client-data-suffix: (get client-data-suffix sig-auth),
    })))
    (match gas
      g (try! (pay-gas-accounted g GAS-ENFORCED))
      true
    )
    (map-delete admins 'SP000000000000000000002Q6VF78)
    (map-set admins new-a true)
    (map-set pubkey-to-admin (get pubkey sig-auth) new-a)
    (var-set owner new-a)
    (update-activity)
    (var-set is-initialized true)
    (var-set pending-init-admin {
      new-admin: 'SP000000000000000000002Q6VF78,
      proposed-at: u0,
      accepted: false,
    })
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
      log-admin-added new-a
    ))
    (ok true)
  )
)

(define-public (veto-pending-init
    (sig-auth {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    })
    (gas (optional <gas-trait>))
  )
  (let ((pending (var-get pending-init-admin)))
    (asserts! (not (var-get is-initialized)) err-already-initialized)
    (asserts! (not (is-eq (get proposed-at pending) u0)) err-no-pending-init)
    (try! (is-authorized (some {
      message-hash: (contract-call?
        'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
        build-veto-init-hash {
        auth-id: (get auth-id sig-auth),
        new-admin: (get new-admin pending),
      }),
      pubkey: (get pubkey sig-auth),
      signature: (get signature sig-auth),
      authenticator-data: (get authenticator-data sig-auth),
      client-data-prefix: (get client-data-prefix sig-auth),
      client-data-suffix: (get client-data-suffix sig-auth),
    })))
    (match gas
      g (try! (pay-gas-accounted g GAS-ENFORCED))
      true
    )
    (var-set pending-init-admin {
      new-admin: 'SP000000000000000000002Q6VF78,
      proposed-at: u0,
      accepted: false,
    })
    (ok true)
  )
)

(define-public (propose-recovery
    (new-recovery principal)
    (sig-auth {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    })
    (gas (optional <gas-trait>))
  )
  (begin
    (try! (is-authorized (some {
      message-hash: (contract-call?
        'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
        build-propose-recovery-hash {
        auth-id: (get auth-id sig-auth),
        new-recovery: new-recovery,
      }),
      pubkey: (get pubkey sig-auth),
      signature: (get signature sig-auth),
      authenticator-data: (get authenticator-data sig-auth),
      client-data-prefix: (get client-data-prefix sig-auth),
      client-data-suffix: (get client-data-suffix sig-auth),
    })))
    (match gas
      g (try! (pay-gas-accounted g GAS-ENFORCED))
      true
    )
    ;; No burn-address check here: confirm-recovery already asserts the pending
    ;; value is not 'SP000...2Q6VF78 before writing it, so proposing the sentinel
    ;; can never take effect. onboard is different -- it writes recovery-address
    ;; directly with no confirm step, so it checks there.
    ;;
    ;; NEVER this contract, though. recover-inactive-wallet gates on
    ;; tx-sender == recovery-address, and as-contract? makes tx-sender this
    ;; contract, so a contract-valued recovery address is a path a gas station
    ;; could reach. update-activity running first makes it unreachable today; this
    ;; keeps it unreachable if that ordering ever changes.
    (asserts! (not (is-eq new-recovery current-contract)) err-unauthorised)
    (var-set pending-recovery new-recovery)
    (update-activity)
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
      log-propose-recovery new-recovery
    ))
    (ok true)
  )
)

(define-public (confirm-recovery)
  (let ((pending (var-get pending-recovery)))
    (asserts! (not (is-eq pending 'SP000000000000000000002Q6VF78))
      err-no-pending-recovery
    )
    (try! (is-admin-calling tx-sender))
    (var-set recovery-address pending)
    (var-set pending-recovery 'SP000000000000000000002Q6VF78)
    (update-activity)
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
      log-confirm-recovery pending
    ))
    (ok true)
  )
)

(define-public (recover-inactive-wallet (new-admin principal))
  (begin
    (asserts! (is-inactive) err-inactive-required)
    (asserts! (is-eq tx-sender (var-get recovery-address)) err-unauthorised)
    (map-delete admins (var-get owner))
    ;; NEVER this contract. as-contract? rebinds tx-sender to this contract,
    ;; so seating it here would let any caller-supplied gas station re-enter
    ;; with sig-auth none and pass is-admin-calling. Clarity's principal
    ;; type does not distinguish a standard principal from a contract one.
    (asserts! (not (is-eq new-admin current-contract)) err-unauthorised)
    (map-set admins new-admin true)
    (var-set owner new-admin)
    (var-set last-activity-block burn-block-height)
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
      log-recover-inactive-wallet new-admin tx-sender
    ))
    (ok true)
  )
)

;; ------------------------------------------------------------ pox-5 staking
;; The wallet stacks its OWN STX with Juice. Every pox-5 call runs inside
;; as-contract? so tx-sender is this contract: pox-5 keys the staker off
;; tx-sender, so the lock lands on the wallet's balance and Juice never
;; custodies anything.
;;
;; ALLOWANCES. Epoch 4.0 made locking STX an asset event in its own right, with
;; its own allowance form: (with-staking uint). with-all-assets-unsafe would
;; have waved through any amount AND every other asset class the safe holds --
;; the escape hatch the pox-4 code needed because there was no stacking
;; allowance to name. There is one now, so nothing here uses it.
;;
;; THE AMOUNT IS A BALANCE, NOT A DELTA. This is the one genuinely
;; counter-intuitive thing on this surface. Post-conditions normally bound what
;; MOVES in a transaction; the stacking entry instead reports what the account
;; now HAS stacked. The node computes it as amount_locked() after the lock and
;; INSERTS (not adds) it into the asset map, and the allowance check is
;; stacked > allowance -> violation. So on a top-up the number to declare is
;; the RESULTING TOTAL: declaring amount-increase aborts every top-up, because
;; existing+increase always exceeds increase. A first-time stake only looks
;; fine because there the increase IS the total.
;;
;; Hence (locked-ustx) on the update path: the pre-call locked balance, straight
;; from the native stx-account, which is the same quantity the node reports.
;; Adding the increase gives the post-call total the allowance is checked
;; against. stake-stx-juice needs no such term -- nothing can be staked when it
;; succeeds, so its amount already IS the total.
;;
;; unstake declares (locked-ustx) unchanged rather than an empty list. pox-5's
;; unstake leaves amount-ustx alone and only shortens num-cycles, so IF the node
;; writes a stacking entry it can only be that same total; and if it writes none,
;; the check is skipped and an unused allowance costs nothing. Declaring it is
;; correct either way, where an empty list is correct only in the second.
;;
;; SIGNATURE SCOPE. Every caller-supplied argument that reaches pox-5 is bound
;; by the signed hash. helpers-v7's build-stack-stx-juice-hash could not do that
;; here -- it covers { auth-id, amount-ustx } because it was written for pox-4
;; delegate-stx, which took an amount and nothing else -- so the pox-5 actions
;; use juice-safe-auth-helpers-v1 instead. What stays constant in this contract
;; (the JUICE-SIGNER destination, and NUM-CYCLES / burn-block-height on the
;; fresh-stake path) needs no binding precisely because a caller cannot vary it.
;; All three are challenged from juice-safe-auth-helpers-v1, including unstake
;; -- it has no caller-supplied argument at all, so helpers-v7's auth-id-only
;; build-revoke-stacking-hash would have worked, but keeping every pox-5 action
;; on one helper keeps one naming scheme in front of the signing prompt.

;; The wallet's own locked uSTX. This is the quantity the node puts in the asset
;; map's stacking entry (it logs amount_locked() after applying the lock), so it
;; is what every (with-staking ...) below is denominated in. Read natively via
;; stx-account -- no pox-5 call, so no cross-contract read and none of the
;; get-staker-info read-only typing trouble.
(define-read-only (locked-ustx)
  (get locked (stx-account current-contract))
)

;; Stake with Juice for the first time -- pox-5 stake.
;;
;; SPLIT FROM update-stake-stx-juice deliberately. pox-5 has two entry points
;; and neither handles both cases (stake returns ERR_ALREADY_STAKED when a
;; position exists, stake-update returns ERR_NOT_STAKING when it does not), so
;; something has to choose. That something is the caller: juiceofbtc.com/stake
;; already reads pox-5 state to decide, so a read here would only be a second
;; answer to a question the front end has already answered. Folding both into
;; one function would also mean one signature covering two different argument
;; meanings -- amount-as-initial-lock vs amount-as-increase.
;;
;; num-cycles is NUM-CYCLES and start-burn-ht is burn-block-height, both
;; constant, so amount-ustx is the only caller-supplied argument and the signed
;; hash covers the whole call.
(define-public (stake-stx-juice
    (amount-ustx uint)
    (sig-auth (optional {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    }))
    (gas (optional <gas-trait>))
  )
  (begin
    (update-activity)
    (match sig-auth
      sig-auth-details (begin
        (asserts! (not (var-get token-lock-enabled)) err-token-locked)
        (try! (is-authorized (some {
          message-hash: (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.juice-safe-auth-helpers-v1
            build-stake-stx-juice-pox5-hash {
            auth-id: (get auth-id sig-auth-details),
            amount-ustx: amount-ustx,
          }),
          pubkey: (get pubkey sig-auth-details),
          signature: (get signature sig-auth-details),
          authenticator-data: (get authenticator-data sig-auth-details),
          client-data-prefix: (get client-data-prefix sig-auth-details),
          client-data-suffix: (get client-data-suffix sig-auth-details),
        })))
        (match gas
          g (try! (pay-gas-accounted g GAS-ENFORCED))
          true
        )
      )
      (try! (is-authorized none))
    )
    (asserts! (> amount-ustx u0) err-zero-amount)
    ;; log-stake-stx-stacking-dao is the deployed core's generic "STX staked"
    ;; event; its name is historical and cannot be changed from here.
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
      log-stake-stx-stacking-dao amount-ustx
    ))
    ;; start-burn-ht must fall inside the CURRENT reward cycle so pox-5 resolves
    ;; first-reward-cycle to current + 1. burn-block-height always does, and
    ;; unlike a caller-supplied height it cannot be wrong or forged.
    ;;
    ;; try!, NOT (err (to-uint ...)): pox-5's errors are already uint. The pox-4
    ;; call sites this template used to carry coerced because pox-4 returns INT
    ;; errors; copying that pattern here does not typecheck.
    ;; amount-ustx IS the resulting total here, so no (locked-ustx) term: pox-5
    ;; rejects stake with ERR_ALREADY_STAKED unless staker-info is absent, and
    ;; this contract is post-fork so it can never be carrying a stray pox-4
    ;; lock either -- nothing is staked when this call succeeds.
    (try! (as-contract? ((with-staking amount-ustx))
      (try! (contract-call? POX5 stake
        JUICE-SIGNER amount-ustx NUM-CYCLES burn-block-height none
      ))
    ))
    (print {
      event: "stake-stx-juice",
      amount-ustx: amount-ustx,
      num-cycles: NUM-CYCLES,
    })
    (ok true)
  )
)

;; Top up an existing Juice position, extend it, or both -- pox-5 stake-update.
;;
;; WHY cycles-to-extend IS AN INPUT. pox-5's lock window is ROLLING, not fixed:
;; stake-update recomputes num-cycles as (unlock-cycle - current-cycle - 1), so
;; a position opened for the 96-cycle maximum has only 86 left ten cycles later.
;; Pinning it to u0 would make every top-up leave the window to decay toward
;; zero with no way to re-top it. pox-5 caps the result at MAX_NUM_CYCLES (u96)
;; and returns ERR_INVALID_NUM_CYCLES (u20) past it, so an over-large value
;; fails loudly rather than doing something surprising.
;;
;; Both signers are JUICE-SIGNER: this wallet can only ever hold a Juice position,
;; and pox-5 rejects a mismatched old-signer itself.
(define-public (update-stake-stx-juice
    (amount-increase uint)
    (cycles-to-extend uint)
    (sig-auth (optional {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    }))
    (gas (optional <gas-trait>))
  )
  (begin
    (update-activity)
    (match sig-auth
      sig-auth-details (begin
        (asserts! (not (var-get token-lock-enabled)) err-token-locked)
        (try! (is-authorized (some {
          message-hash: (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.juice-safe-auth-helpers-v1
            build-update-stake-stx-juice-hash {
            auth-id: (get auth-id sig-auth-details),
            amount-increase: amount-increase,
            cycles-to-extend: cycles-to-extend,
          }),
          pubkey: (get pubkey sig-auth-details),
          signature: (get signature sig-auth-details),
          authenticator-data: (get authenticator-data sig-auth-details),
          client-data-prefix: (get client-data-prefix sig-auth-details),
          client-data-suffix: (get client-data-suffix sig-auth-details),
        })))
        (match gas
          g (try! (pay-gas-accounted g GAS-ENFORCED))
          true
        )
      )
      (try! (is-authorized none))
    )
    ;; A pure extend (amount u0) and a pure top-up (cycles u0) are both
    ;; legitimate; a call that does neither is a no-op worth rejecting.
    (asserts! (or (> amount-increase u0) (> cycles-to-extend u0)) err-zero-amount)
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
      log-stake-stx-stacking-dao amount-increase
    ))
    ;; amount-increase is the DELTA, not the new total: pox-5 adds it to the
    ;; existing amount-ustx and only the delta is newly locked. A pure extend
    ;; passes u0 here and locks nothing.
    ;; (locked-ustx) + amount-increase = the total pox-5 will report. Declaring
    ;; amount-increase alone aborts every top-up -- see ALLOWANCES above.
    (try! (as-contract? ((with-staking (+ (locked-ustx) amount-increase)))
      (try! (contract-call? POX5 stake-update
        JUICE-SIGNER JUICE-SIGNER cycles-to-extend amount-increase none
      ))
    ))
    (print {
      event: "update-stake-stx-juice",
      amount-increase: amount-increase,
      cycles-to-extend: cycles-to-extend,
    })
    (ok true)
  )
)

;; Leave Juice. pox-5 removes the wallet's shares from current-cycle + 1, so the
;; cycle in progress still pays out; the STX unlocks when its lock ends.
;;
;; Getting OUT must always work, so this stays reachable by every factor the
;; wallet accepts. The signed hash is auth-id only: pox-5's unstake takes just
;; the old signer-manager, and that is the JUICE-SIGNER constant here.
(define-public (unstake
    (sig-auth (optional {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    }))
    (gas (optional <gas-trait>))
  )
  (begin
    (update-activity)
    (match sig-auth
      sig-auth-details (begin
        (asserts! (not (var-get token-lock-enabled)) err-token-locked)
        (try! (is-authorized (some {
          message-hash: (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.juice-safe-auth-helpers-v1
            build-unstake-stx-juice-hash { auth-id: (get auth-id sig-auth-details) }
          ),
          pubkey: (get pubkey sig-auth-details),
          signature: (get signature sig-auth-details),
          authenticator-data: (get authenticator-data sig-auth-details),
          client-data-prefix: (get client-data-prefix sig-auth-details),
          client-data-suffix: (get client-data-suffix sig-auth-details),
        })))
        (match gas
          g (try! (pay-gas-accounted g GAS-ENFORCED))
          true
        )
      )
      (try! (is-authorized none))
    )

    ;; log-revoke-fast-pool is the deployed core's generic "stopped stacking"
    ;; event; its name is historical and cannot be changed from here.
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
      log-revoke-fast-pool
    ))

    ;; (with-pox) -- the allowance built for exactly this call. SIP-044 defines
    ;; it as "interacting with the latest PoX contract ... functions that act on
    ;; behalf of tx-sender and do NOT trigger a staking event", and names
    ;; unstake first in its list (also unstake-sbtc, update-bond-registration,
    ;; announce-l1-early-exit). The SIP's own example is this exact call with an
    ;; empty allowance list failing and ((with-pox)) succeeding.
    ;;
    ;; SUPERSEDES an escape hatch. This used to be (with-all-assets-unsafe),
    ;; chosen after probing every Clarity 4 form and finding they all returned
    ;; (err u128) = MAX_ALLOWANCES, "an asset class moved with no allowance
    ;; covering it". That probe was not wrong, it was version-bound: with-pox
    ;; did not exist below Clarity 6. Flagged by Brice Dobry.
    ;;
    ;; WHY THE TIGHTENING IS WORTH IT even though we call pox-5 directly. The
    ;; allowance never gated the call, only its EFFECTS. unsafe blanket-approved
    ;; every asset class for the duration; (with-pox) approves PoX state changes
    ;; and nothing else, so an STX/FT/NFT outflow from this body now reverts
    ;; instead of sailing through. That is not hypothetical in this contract:
    ;; pox-5's neighbouring unstake-sbtc DOES transfer sBTC out, and pox-5's
    ;; stake path calls INTO the caller-supplied signer-manager
    ;; (signer-manager-validate-stake -> contract-call? signer-manager
    ;; validate-stake!), which is why pox-5 carries its own
    ;; validate-no-reentrancy guard. Plain unstake touches neither today; the
    ;; allowance is what keeps that true after a future edit or a pox upgrade.
    (try! (as-contract? ((with-pox))
      (try! (contract-call? POX5 unstake JUICE-SIGNER))
    ))
    (print { event: "unstake" })
    (ok true)
  )
)

(define-public (wager-deposit
    (token <sip-010-trait>)
    (token-name (string-ascii 128))
    (amount uint)
    (pubkey (buff 33))
    (sig-auth (optional {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    }))
    (gas (optional <gas-trait>))
  )
  (begin
    (update-activity)
    (match sig-auth
      sig-auth-details (begin
        (try! (is-authorized (some {
          message-hash: (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
            build-wager-deposit-hash {
            auth-id: (get auth-id sig-auth-details),
            amount: amount,
            pubkey: pubkey,
            token: (contract-of token),
          }),
          pubkey: (get pubkey sig-auth-details),
          signature: (get signature sig-auth-details),
          authenticator-data: (get authenticator-data sig-auth-details),
          client-data-prefix: (get client-data-prefix sig-auth-details),
          client-data-suffix: (get client-data-suffix sig-auth-details),
        })))
        (match gas
          g (try! (pay-gas-accounted g GAS-ENFORCED))
          true
        )
      )
      (try! (is-authorized none))
    )
    (asserts!
      (is-eq (some current-contract)
        (contract-call? 'SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK.game-wager-v2-4
          get-registered-wallet pubkey
        ))
      err-unauthorised
    )
    (as-contract? ((with-ft (contract-of token) token-name amount))
      (try! (contract-call? 'SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK.game-wager-v2-4
        deposit token amount pubkey
      ))
    )
  )
)

(map-set admins 'SP000000000000000000002Q6VF78 true)

;; NOTE: register-wallet names THIS contract. v9 shipped naming
;; .fakfun-wallet-v8 -- a copy-paste leftover -- so core's hash check compared
;; v9's own hash against v8's and failed with (err u6002), making onboard
;; impossible and every v9 wallet uncreatable. That is why v10 exists.
(define-public (onboard (pubkey (buff 33)))
  (begin
    (asserts! (is-eq tx-sender FAKFUN-DEPLOYER) err-unauthorised)
    (asserts! (not (var-get pubkey-initialized)) err-unauthorised)
    (var-set initial-pubkey pubkey)
    (map-set pubkey-to-admin pubkey 'SP000000000000000000002Q6VF78)
    (var-set pubkey-initialized true)
    ;; Pre-approve the xtrata-inscribe extension at deploy time so NEW wallets can
    ;; inscribe immediately -- no 2-step whitelist, no 24h cooldown. Trust note:
    ;; this hard-codes trust in one fixed, audited extension that only forwards a
    ;; payload to Xtrata mint-single-tx (spends the STX fee, mints the NFT back to
    ;; the wallet); it cannot drain the wallet. Editing this template changes the
    ;; canonical hash -> requires a NEW verified version (see register-wallet ref).
    (map-set whitelisted-extensions
      'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.xtrata-inscribe true
    )
    (try! (as-contract? ()
      (try! (contract-call?
        'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
        register-wallet
        'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-v15
      ))
    ))
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
      log-wallet-initialized pubkey
    ))
    (ok true)
  )
)