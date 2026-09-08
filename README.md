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
2. Load `contracts/return_guard.py`.
3. Deploy the contract with no constructor arguments.
4. Call `submit_case` using `examples/sample_case.json`.
5. Call `adjudicate` with the same `case_id`.
6. Read the final result with `get_decision`.

## Security choices

- Required case fields are validated before submission.
- Evidence is explicitly treated as untrusted data, not instructions.
- Output values are constrained to three decision types.
- Validators independently review the judgment under the contract's Equivalence Principle.
- Every case is stored independently by `case_id`; later submissions cannot overwrite earlier cases.
- Once a case has a decision, repeat `adjudicate` calls are rejected.
- Unclear cases are routed to human review.
- The contract does not move real funds.

## Live MVP status

The interface connects a real browser wallet, submits new cases to the deployed multi-case Intelligent Contract, starts full AI consensus, reads the resulting decision, and links every transaction to the Studionet explorer.

- Contract: [`0x23053f5bac38464Bffcf857b8A8bDeB5aa0dca28`](https://explorer-studio.genlayer.com/address/0x23053f5bac38464Bffcf857b8A8bDeB5aa0dca28)
- Deployment transaction: [`0xcf2e45229737cf1d290a98736af37bdbca5f3504a8ea6efaabb6a6c61faeb30d`](https://explorer-studio.genlayer.com/tx/0xcf2e45229737cf1d290a98736af37bdbca5f3504a8ea6efaabb6a6c61faeb30d)
- Decision transactions are generated per case and linked from the interface after consensus.

## License

MIT
