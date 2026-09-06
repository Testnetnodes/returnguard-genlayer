# ReturnGuard

ReturnGuard is an autonomous ecommerce return-dispute adjudicator built with GenLayer. It applies a merchant's written policy to claims and evidence submitted by both sides, then stores the accepted decision and rationale onchain.

## The problem

Marketplace return disputes are slow, inconsistent, and expensive to review manually. Rule-based automation also fails when the evidence is unstructured or the policy requires judgment.

## How it works

1. A merchant submits the return policy, customer claim, merchant response, and evidence summary.
2. A GenLayer leader validator produces a structured decision.
3. Other validators independently review the same case.
4. Validators compare the stable settlement fields: `decision`, `policy_test`, and confidence within a defined tolerance.
5. The accepted result is written to the Intelligent Contract's state.

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
contracts/return_guard_studio.py  Deployed GenLayer Intelligent Contract
contracts/return_guard.py         Multi-case contract iteration
tests/direct/test_return_guard.py Direct-mode contract tests
examples/sample_case.json         Example dispute input
```

## Run the interface

Requirements: Node.js 22+

```bash
npm install
npm run dev
```

The live interface uses `genlayer-js` with an EIP-1193 browser wallet. It selects MetaMask when multiple wallet extensions are installed and switches directly to GenLayer Studionet before signing `submit_case` and `adjudicate` as two separate transactions. Studionet uses test GEN from the built-in Studio faucet.

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
2. Load `contracts/return_guard_studio.py`.
3. Deploy the contract with no constructor arguments.
4. Call `submit_case` using `examples/sample_case.json`.
5. Call `adjudicate` with the same `case_id`.
6. Read the final result with `get_decision`.

## Security choices

- Required case fields are validated before submission.
- Evidence is explicitly treated as untrusted data, not instructions.
- Output values are constrained to three decision types.
- Validators independently review the judgment under the contract's Equivalence Principle.
- Unclear cases are routed to human review.
- The Studio-friendly MVP keeps one active case and does not move real funds.

## Live MVP status

The interface connects a real browser wallet, submits new cases to the deployed Intelligent Contract, starts full AI consensus, reads the resulting decision, and links every transaction to the Studionet explorer. A previously finalized sample remains available as proof.

- Contract: `0x247236463bA0eb9D7428c54780226B2772c43c8B`
- Deployment transaction: `0xc798ae97738c637371e4764144e33c6b0dd239dd1b2e8dc0c8dec99aa6ecff19`
- Full-consensus decision: `0x16c99579769b603e787bdceda3fe66b936ad95759aa0b29427220fbb220f8a75`

## License

MIT
