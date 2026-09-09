# ReturnGuard

ReturnGuard is an autonomous ecommerce return-dispute adjudicator built with GenLayer. It binds each case to a merchant, a customer, a precommitted policy, and native GEN escrow; validator consensus then determines where the escrow goes.

## The problem

Marketplace return disputes are slow, inconsistent, and expensive to review manually. Rule-based automation also fails when the evidence is unstructured or the policy requires judgment.

## How it works

1. A merchant wallet publishes its return policy before any case exists.
2. The same merchant opens a case, names one customer wallet, submits only the merchant side, and locks native test GEN in the payable contract.
3. Only that bound customer wallet can accept the case and submit the customer claim and evidence.
4. Only either bound party can start adjudication; outsiders are rejected.
5. Validators independently reproduce the policy judgment and compare the stable settlement fields.
6. `REFUND_APPROVED` queues the escrow to the customer, while `REFUND_REJECTED` queues it back to the merchant when the decision finalizes.
7. `MANUAL_REVIEW` keeps escrow locked until one party proposes a settlement recipient and the other party confirms it.

Possible outcomes:

- `REFUND_APPROVED`
- `REFUND_REJECTED`
- `MANUAL_REVIEW`

`MANUAL_REVIEW` is a deliberate safety outcome for contradictory evidence, missing facts, or ambiguous policies. Neither side can release its escrow alone.

## Why GenLayer

Traditional contracts can enforce explicit conditions but cannot reliably interpret natural-language policies and conflicting evidence. ReturnGuard uses GenLayer's Equivalence Principle so one AI model does not decide alone. The validator set independently reproduces the judgment and compares only the fields that affect settlement.

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
- Validators independently review the judgment under the contract's Equivalence Principle.
- Every case is stored independently by `case_id`; later submissions cannot overwrite earlier cases.
- Once a case has a decision, repeat `adjudicate` calls are rejected.
- Approved or rejected decisions emit a native GEN transfer to the correct party on finalization.
- Unclear cases keep funds locked and require both parties for manual settlement.

## Live MVP status

The interface connects a real browser wallet, enforces the merchant/customer handoff, funds native test GEN escrow, starts full AI consensus, reads the decision, and links every transaction to the Studionet explorer.

- Contract: [`0xf7a96A3e207B244fd9BdF8Ee0904285eb30fd501`](https://explorer-studio.genlayer.com/address/0xf7a96A3e207B244fd9BdF8Ee0904285eb30fd501)
- Deployment transaction: [`0xfdacf11b438a59ac6e2701c11681345722c28017a284765d9bb791a792a915f0`](https://explorer-studio.genlayer.com/tx/0xfdacf11b438a59ac6e2701c11681345722c28017a284765d9bb791a792a915f0)
- Merchant policy transaction: [`0xb68f50f6c81fd43d0ab5d84ce39d3e6ffac1b2ade62016c8a63f75f247a2327f`](https://explorer-studio.genlayer.com/tx/0xb68f50f6c81fd43d0ab5d84ce39d3e6ffac1b2ade62016c8a63f75f247a2327f)
- Escrow funding transaction: [`0x3153d10ef1856b286aeefda89349da029be48aace0f11840c97da7b22a8bd5be`](https://explorer-studio.genlayer.com/tx/0x3153d10ef1856b286aeefda89349da029be48aace0f11840c97da7b22a8bd5be)
- Bound customer acceptance: [`0x7f1bebef87c4caa710f55803deee082a8f58ae3dccc0cc98063cdd9565b4f9c0`](https://explorer-studio.genlayer.com/tx/0x7f1bebef87c4caa710f55803deee082a8f58ae3dccc0cc98063cdd9565b4f9c0)
- Decision transactions are generated per case and linked from the interface after consensus.

## License

MIT
