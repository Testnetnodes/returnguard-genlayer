# ReturnGuard

ReturnGuard is an autonomous ecommerce return-dispute adjudicator built with GenLayer. It binds each case to a merchant, a customer, a precommitted policy, and native GEN escrow; validator consensus then determines where the escrow goes.

## The problem

Marketplace return disputes are slow, inconsistent, and expensive to review manually. Rule-based automation also fails when the evidence is unstructured or the policy requires judgment.

## How it works

1. A merchant wallet publishes its return policy before any case exists.
2. The same merchant opens a case, names one customer wallet, submits only the merchant side, and locks native test GEN in the payable contract.
3. Only that bound customer wallet can accept the case and submit the customer claim and evidence.
4. Only either bound party can start adjudication; outsiders are rejected.
5. Validators independently reproduce the policy judgment. Equivalence compares only the normalized `decision` enum; rationale wording, policy-test labels, confidence, and key-fact prose are intentionally not compared.
6. `REFUND_APPROVED` queues the escrow to the customer, while `REFUND_REJECTED` queues it back to the merchant when the decision finalizes.
7. `MANUAL_REVIEW` keeps escrow locked. Either bound party can record a recipient plus rationale with `propose_manual_settlement`; only the other party can finalize that exact proposal with `confirm_manual_settlement`.

Possible outcomes:

- `REFUND_APPROVED`
- `REFUND_REJECTED`
- `MANUAL_REVIEW`

`MANUAL_REVIEW` is a deliberate safety outcome for contradictory evidence, missing facts, or ambiguous policies. It is not a terminal dead end: the proposal and rationale are stored onchain, the other party must confirm, and the confirmed resolution is appended to the case decision before escrow is released. Neither side can release escrow alone.

## Why GenLayer

Traditional contracts can enforce explicit conditions but cannot reliably interpret natural-language policies and conflicting evidence. ReturnGuard uses GenLayer's Equivalence Principle so one AI model does not decide alone. The validator set independently reproduces the judgment and binds consensus only to the decision enum. Free-form rationale remains auditable output but is explicitly excluded from equivalence, so validators can agree on the outcome while explaining it differently.

## Repository structure

```text
app/                              Interactive product demo
contracts/return_guard.py         Deployed multi-case Intelligent Contract
contracts/return_guard_studio.py  Legacy single-case prototype (not deployed)
tests/direct/test_return_guard.py Direct-mode contract tests
examples/sample_case.json         Example dispute input
```

## Run the interface

Requirements: Node.js 22+

```bash
npm install
npm run dev
```

The live interface uses `genlayer-js` with an EIP-1193 browser wallet. It selects MetaMask when multiple wallet extensions are installed and switches directly to GenLayer Studionet. The merchant signs `publish_policy` and payable `submit_case`; the customer switches to the bound wallet and signs `accept_case`; either party can then sign `adjudicate`. Studionet uses test GEN from the built-in Studio faucet.

## Validate the contract

Requirements: Python 3.12+

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
genvm-lint check contracts/return_guard.py
pytest tests/direct -v
```

## Deploy in GenLayer Studio

1. Open [GenLayer Studio](https://studio.genlayer.com/).
2. Load `contracts/return_guard.py`.
3. Deploy the contract with no constructor arguments.
4. Call `publish_policy` with the policy text from `examples/sample_case.json`.
5. From the same merchant wallet, call payable `submit_case` with the policy hash, customer address, merchant response, merchant evidence, and a nonzero GEN value.
6. Switch to the exact customer wallet and call `accept_case` with the customer claim and evidence.
7. From either bound wallet, call `adjudicate` with the same `case_id`.
8. Read `get_decision`, `get_case_status`, and `get_escrow_amount`.
9. For `MANUAL_REVIEW`, call `propose_manual_settlement(case_id, "CUSTOMER" | "MERCHANT", rationale)` from either bound wallet, inspect `get_manual_proposal`, then call `confirm_manual_settlement(case_id)` from the other wallet.

## Security choices

- Required case fields are validated before submission.
- Policies are published in a separate transaction before a case can reference them.
- The contract computes each policy's SHA-256 hash and permanently binds the case to that immutable registry entry.
- Policy commitments are stored per merchant wallet with their publication time.
- Only that policy-owning merchant can create and fund a case under the policy.
- Every case binds one merchant and one different customer address.
- The customer claim and evidence require a separate transaction signed by the bound customer.
- `submit_case` is payable and rejects zero-value cases.
- Only the two bound parties can call `adjudicate`.
- Evidence is explicitly treated as untrusted data, not instructions.
- Output values are constrained to three decision types.
- Validators independently review the judgment under the contract's Equivalence Principle; only the normalized decision enum is compared, never free-form rationale.
- Every case is stored independently by `case_id`; later submissions cannot overwrite earlier cases.
- Once a case has a decision, repeat `adjudicate` calls are rejected.
- Approved or rejected decisions emit a native GEN transfer to the correct party on finalization.
- Unclear cases keep funds locked until one bound party records a recipient and rationale and the other party confirms the proposal.

## Live MVP status

The interface connects a real browser wallet, enforces the merchant/customer handoff, funds native test GEN escrow, starts full AI consensus, and provides an onchain propose/confirm workflow for manual settlements. Every transaction is linked to the Studionet explorer.

- Contract: [`0x64E8C5D7A4E8627e83Fe80e10d10681E944f5e58`](https://explorer-studio.genlayer.com/address/0x64E8C5D7A4E8627e83Fe80e10d10681E944f5e58)
- Deployment transaction: [`0xe64d3875860889ab795ff95d8b9bac237ef06ff39a68025e1ff64b7af6209f5f`](https://explorer-studio.genlayer.com/tx/0xe64d3875860889ab795ff95d8b9bac237ef06ff39a68025e1ff64b7af6209f5f)
- Policy, escrow, acceptance, AI decision, manual proposal, and manual confirmation transactions are generated per case and linked from the interface.

## License

MIT
