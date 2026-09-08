# ReturnGuard

ReturnGuard is an autonomous ecommerce return-dispute adjudicator built with GenLayer. It applies a merchant's written policy to claims and evidence submitted by both sides, then stores the accepted decision and rationale onchain.

## The problem

Marketplace return disputes are slow, inconsistent, and expensive to review manually. Rule-based automation also fails when the evidence is unstructured or the policy requires judgment.

## How it works

1. A merchant publishes the return policy in its own onchain transaction before any case exists.
2. The contract computes the policy's SHA-256 hash and stores the immutable text, publisher, and publication time.
3. A later case submits claims and evidence while referencing only that registered policy hash.
4. A GenLayer leader validator produces a structured decision and the other validators independently review it.
5. Validators compare the stable settlement fields: `decision`, `policy_test`, and confidence within a defined tolerance.
6. The accepted result is written to the Intelligent Contract's state.

Possible outcomes:

- `REFUND_APPROVED`
- `REFUND_REJECTED`
- `MANUAL_REVIEW`

`MANUAL_REVIEW` is a deliberate safety outcome for contradictory evidence, missing facts, or ambiguous policies.

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

The live interface uses `genlayer-js` with an EIP-1193 browser wallet. It selects MetaMask when multiple wallet extensions are installed and switches directly to GenLayer Studionet. The wallet signs `publish_policy`, `submit_case`, and `adjudicate` as separate transactions. Studionet uses test GEN from the built-in Studio faucet.

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
5. Call `submit_case` with the returned policy's expected SHA-256 hash and the case fields.
6. Call `adjudicate` with the same `case_id`.
7. Read the final result with `get_decision`.

## Security choices

- Required case fields are validated before submission.
- Policies are published in a separate transaction before a case can reference them.
- The contract computes each policy's SHA-256 hash and permanently binds the case to that immutable registry entry.
- Policy publisher and transaction time are retained for an auditable precommitment trail.
- Evidence is explicitly treated as untrusted data, not instructions.
- Output values are constrained to three decision types.
- Validators independently review the judgment under the contract's Equivalence Principle.
- Every case is stored independently by `case_id`; later submissions cannot overwrite earlier cases.
- Once a case has a decision, repeat `adjudicate` calls are rejected.
- Unclear cases are routed to human review.
- The contract does not move real funds.

## Live MVP status

The interface connects a real browser wallet, precommits the policy, submits cases bound to that policy hash, starts full AI consensus, reads the resulting decision, and links every transaction to the Studionet explorer.

- Contract: [`0x0dEe3259d5c17eE009080a4aA2e951D6b4a98220`](https://explorer-studio.genlayer.com/address/0x0dEe3259d5c17eE009080a4aA2e951D6b4a98220)
- Deployment transaction: [`0x8507e55dfeca0027da7b370276bbfa6a625a1173bdd13af68d4d6bbf69360001`](https://explorer-studio.genlayer.com/tx/0x8507e55dfeca0027da7b370276bbfa6a625a1173bdd13af68d4d6bbf69360001)
- Sample policy precommitment: [`0x404225214e3f8455b467d496c3dc1e90520607bcb59161012c508433363ab68a`](https://explorer-studio.genlayer.com/tx/0x404225214e3f8455b467d496c3dc1e90520607bcb59161012c508433363ab68a)
- Decision transactions are generated per case and linked from the interface after consensus.

## License

MIT
