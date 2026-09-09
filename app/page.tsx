"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BrainCircuit,
  Check,
  Circle,
  CircleAlert,
  ExternalLink,
  FileCheck2,
  FileText,
  LoaderCircle,
  LockKeyhole,
  Network,
  Scale,
  Send,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toaster } from "@/components/ui/sonner";
import { Textarea } from "@/components/ui/textarea";

type ReviewState =
  | "idle"
  | "publishing-policy"
  | "policy-ready"
  | "funding"
  | "awaiting-customer"
  | "accepting-case"
  | "ready"
  | "deliberating"
  | "resolved"
  | "manual-review";
type PendingAction =
  | "wallet"
  | "policy"
  | "submit"
  | "accept"
  | "consensus"
  | "check"
  | "manual-propose"
  | "manual-confirm"
  | null;

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
  on?: (event: string, listener: (payload: unknown) => void) => void;
  removeListener?: (event: string, listener: (payload: unknown) => void) => void;
  isMetaMask?: boolean;
  isBraveWallet?: boolean;
  isRabby?: boolean;
  providers?: EthereumProvider[];
};

type EIP6963ProviderDetail = {
  info: { uuid: string; name: string; rdns: string };
  provider: EthereumProvider;
};

type Decision = {
  decision: "REFUND_APPROVED" | "REFUND_REJECTED" | "MANUAL_REVIEW";
  rationale: string;
  key_fact: string;
  settlement?: "CUSTOMER" | "MERCHANT" | "LOCKED_PENDING_BOTH_PARTIES";
  escrow_amount_wei?: string;
  manual_resolution?: "CUSTOMER" | "MERCHANT";
  manual_rationale?: string;
  manual_proposer?: string;
  manual_confirmer?: string;
};

type ManualProposal = {
  recipient: "CUSTOMER" | "MERCHANT";
  rationale: string;
  proposer: string;
  proposed_at: string;
};

const stages = [
  { id: "policy", label: "Merchant policy committed", detail: "Policy hash is bound to the merchant wallet" },
  { id: "escrow", label: "Escrow funded", detail: "Merchant locks native test GEN for this case" },
  { id: "customer", label: "Customer accepted", detail: "Bound customer submits the claim separately" },
  { id: "deliberating", label: "Validators deliberating", detail: "Consensus compares the decision enum only, never rationale wording" },
  { id: "resolved", label: "Escrow settlement", detail: "Decision routes GEN or keeps it jointly locked" },
] as const;

const progressByState: Record<ReviewState, number> = {
  idle: 0,
  "publishing-policy": 12,
  "policy-ready": 20,
  funding: 32,
  "awaiting-customer": 45,
  "accepting-case": 54,
  ready: 64,
  deliberating: 82,
  resolved: 100,
  "manual-review": 92,
};

const contractAddress = "0x64E8C5D7A4E8627e83Fe80e10d10681E944f5e58";
const deploymentTx = "0xe64d3875860889ab795ff95d8b9bac237ef06ff39a68025e1ff64b7af6209f5f";
const explorerBase = "https://explorer-studio.genlayer.com/tx";
const contractExplorerBase = "https://explorer-studio.genlayer.com/address";
const siteUrl = "https://returnguard-genlayer.mustafaiciren.chatgpt.site";
const studionetChainId = "0xf22f";
const studionetParams = {
  chainId: studionetChainId,
  chainName: "GenLayer Studio Network",
  nativeCurrency: { name: "GEN Token", symbol: "GEN", decimals: 18 },
  rpcUrls: ["https://studio.genlayer.com/api"],
  blockExplorerUrls: ["https://explorer-studio.genlayer.com"],
};

const announcedProviders = new Map<string, EIP6963ProviderDetail>();
let providerDiscoveryStarted = false;

async function loadGenLayer() {
  const [sdk, chains, types] = await Promise.all([
    import("genlayer-js"),
    import("genlayer-js/chains"),
    import("genlayer-js/types"),
  ]);
  return { ...sdk, ...chains, ...types };
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function requestProviderAnnouncements() {
  if (typeof window === "undefined") return;

  if (!providerDiscoveryStarted) {
    window.addEventListener("eip6963:announceProvider", ((event: CustomEvent<EIP6963ProviderDetail>) => {
      const detail = event.detail;
      if (!detail?.info?.uuid || typeof detail.provider?.request !== "function") return;
      announcedProviders.set(detail.info.uuid, detail);
    }) as EventListener);
    providerDiscoveryStarted = true;
  }

  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

async function getEthereumProvider() {
  if (typeof window === "undefined") return undefined;
  requestProviderAnnouncements();
  await new Promise((resolve) => window.setTimeout(resolve, 180));

  const announced = Array.from(announcedProviders.values());
  const metamask = announced.find(({ info }) => {
    const rdns = info.rdns.toLowerCase();
    const name = info.name.toLowerCase();
    return rdns === "io.metamask" || name === "metamask";
  });
  if (metamask) return metamask.provider;

  const ethereum = (window as Window & { ethereum?: EthereumProvider }).ethereum;
  if (!ethereum) return undefined;

  const providers = ethereum.providers ?? [];
  return (
    providers.find((provider) => provider.isMetaMask && !provider.isBraveWallet && !provider.isRabby) ??
    providers.find((provider) => provider.isMetaMask) ??
    ethereum
  );
}

function walletErrorCode(error: unknown) {
  if (typeof error === "object" && error && "code" in error) {
    return Number((error as { code: unknown }).code);
  }
  if (typeof error === "object" && error) {
    const details = error as Record<string, unknown>;
    for (const key of ["error", "data", "cause"]) {
      const nestedCode = walletErrorCode(details[key]);
      if (nestedCode !== undefined) return nestedCode;
    }
  }
  return undefined;
}

async function ensureStudionet(provider: EthereumProvider) {
  const currentChainId = await provider.request({ method: "eth_chainId" });
  if (String(currentChainId).toLowerCase() === studionetChainId) return;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: studionetChainId }],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (walletErrorCode(error) !== 4902 && !message.includes("unrecognized") && !message.includes("not added")) {
      throw error;
    }
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [studionetParams],
    });
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: studionetChainId }],
    });
  }
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function isAddress(value: string) {
  return /^0x[0-9a-fA-F]{40}$/.test(value.trim());
}

function parseGenAmount(value: string) {
  const normalized = value.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(normalized)) throw new Error("Enter a valid escrow amount with up to 18 decimals.");
  const [whole, fraction = ""] = normalized.split(".");
  const amount = BigInt(whole) * 10n ** 18n + BigInt((fraction + "0".repeat(18)).slice(0, 18));
  if (amount <= 0n) throw new Error("Escrow must be greater than zero GEN.");
  return amount;
}

function walletErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return "";

  const details = error as Record<string, unknown>;
  for (const key of ["message", "shortMessage", "reason", "details"]) {
    if (typeof details[key] === "string" && details[key].trim()) return details[key];
  }
  for (const key of ["error", "data", "cause"]) {
    const nested = walletErrorMessage(details[key]);
    if (nested) return nested;
  }
  return "";
}

function readableWalletError(error: unknown) {
  const message = walletErrorMessage(error);
  const normalized = message.toLowerCase();
  if (walletErrorCode(error) === 4001 || normalized.includes("user rejected") || message.includes("4001")) {
    return "The wallet request was cancelled.";
  }
  if (normalized.includes("metamask is not installed")) {
    return "No compatible wallet was found. Open the site in a browser tab where MetaMask is enabled.";
  }
  if (normalized.includes("chain") || normalized.includes("network")) {
    return "Studionet could not be added to the wallet. Approve the network request and try again.";
  }
  return !message || message.length > 140 ? "The wallet could not complete this request. Please try again." : message;
}

function parseDecision(value: unknown): Decision | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as Partial<Decision>;
    if (
      !parsed.decision ||
      !["REFUND_APPROVED", "REFUND_REJECTED", "MANUAL_REVIEW"].includes(parsed.decision) ||
      typeof parsed.rationale !== "string" ||
      typeof parsed.key_fact !== "string"
    ) {
      return null;
    }
    return parsed as Decision;
  } catch {
    return null;
  }
}

function parseManualProposal(value: unknown): ManualProposal | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as Partial<ManualProposal>;
    if (
      !parsed.recipient ||
      !["CUSTOMER", "MERCHANT"].includes(parsed.recipient) ||
      typeof parsed.rationale !== "string" ||
      typeof parsed.proposer !== "string" ||
      typeof parsed.proposed_at !== "string"
    ) {
      return null;
    }
    return parsed as ManualProposal;
  } catch {
    return null;
  }
}

function decisionTitle(decision: Decision) {
  if (decision.decision === "REFUND_APPROVED") return "Refund approved";
  if (decision.decision === "MANUAL_REVIEW" && decision.settlement !== "LOCKED_PENDING_BOTH_PARTIES") {
    return "Manual settlement finalized";
  }
  if (decision.decision === "MANUAL_REVIEW") return "Manual review";
  return "Refund rejected";
}

export default function Home() {
  const walletProviderRef = useRef<EthereumProvider | null>(null);
  const [reviewState, setReviewState] = useState<ReviewState>("idle");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [policyHash, setPolicyHash] = useState<string | null>(null);
  const [policyTxHash, setPolicyTxHash] = useState<string | null>(null);
  const [caseTxHash, setCaseTxHash] = useState<string | null>(null);
  const [acceptanceTxHash, setAcceptanceTxHash] = useState<string | null>(null);
  const [decisionTxHash, setDecisionTxHash] = useState<string | null>(null);
  const [manualProposalTxHash, setManualProposalTxHash] = useState<string | null>(null);
  const [manualSettlementTxHash, setManualSettlementTxHash] = useState<string | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [manualProposal, setManualProposal] = useState<ManualProposal | null>(null);
  const [manualRecipient, setManualRecipient] = useState<"CUSTOMER" | "MERCHANT">("CUSTOMER");
  const [manualRationale, setManualRationale] = useState("");
  const [walletNotice, setWalletNotice] = useState<string | null>(null);
  const [orderId, setOrderId] = useState("RG-4821");
  const [category, setCategory] = useState("electronics");
  const [customerAddress, setCustomerAddress] = useState("");
  const [escrowAmount, setEscrowAmount] = useState("0.01");
  const [policy, setPolicy] = useState(
    "Returns are accepted within 14 days when the product is unused and the original packaging is undamaged. Opened or visibly used products are not eligible unless defective."
  );
  const [customerClaim, setCustomerClaim] = useState(
    "I tested the monitor for one evening, but the colors looked warmer than expected. The item works and all accessories are included. I want a full refund."
  );
  const [merchantResponse, setMerchantResponse] = useState(
    "The retail box arrived torn, the protective seal was removed, and the stand shows handling marks. The device activation log shows six hours of use."
  );
  const [evidence, setEvidence] = useState(
    "Courier record: parcel delivered without reported damage. Merchant photos: torn box corner, removed seal, fingerprints on stand. Customer confirms the monitor was tested."
  );
  const [customerEvidence, setCustomerEvidence] = useState(
    "Customer delivery photos and the order receipt are attached."
  );

  useEffect(() => {
    const handleAccounts = (payload: unknown) => {
      const accounts = Array.isArray(payload) ? (payload as string[]) : [];
      const address = accounts[0] ?? null;
      setWalletAddress(address);
      if (address) setWalletNotice(null);
    };

    const handleChain = (payload: unknown) => {
      if (String(payload).toLowerCase() === studionetChainId) setWalletNotice(null);
    };

    let provider: EthereumProvider | undefined;
    let disposed = false;

    getEthereumProvider().then((selectedProvider) => {
      if (!selectedProvider || disposed) return;
      provider = selectedProvider;
      walletProviderRef.current = selectedProvider;
      selectedProvider.request({ method: "eth_accounts" }).then(handleAccounts).catch(() => undefined);
      selectedProvider.on?.("accountsChanged", handleAccounts);
      selectedProvider.on?.("chainChanged", handleChain);
    });

    return () => {
      disposed = true;
      provider?.removeListener?.("accountsChanged", handleAccounts);
      provider?.removeListener?.("chainChanged", handleChain);
    };
  }, []);

  const createWalletClient = async (address: string) => {
    const provider = walletProviderRef.current ?? (await getEthereumProvider());
    if (!provider) throw new Error("MetaMask is not installed.");
    walletProviderRef.current = provider;
    await ensureStudionet(provider);
    const { createClient, studionet } = await loadGenLayer();
    return createClient({
      chain: studionet,
      account: address as `0x${string}`,
      provider: provider as never,
    });
  };

  const connectWallet = async () => {
    const provider = await getEthereumProvider();
    if (!provider) {
      const message = "Wallet extension not detected. Open ReturnGuard in a regular browser tab and enable MetaMask.";
      setWalletNotice(message);
      toast.error(message);
      return null;
    }

    setPendingAction("wallet");
    try {
      walletProviderRef.current = provider;
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      const address = accounts[0];
      if (!address) throw new Error("No wallet account was selected.");

      setWalletAddress(address);
      await ensureStudionet(provider);
      setWalletNotice(null);
      toast.success("Wallet connected to GenLayer Studionet.");
      return address;
    } catch (error) {
      const message = readableWalletError(error);
      setWalletNotice(message);
      toast.error(message);
      return null;
    } finally {
      setPendingAction(null);
    }
  };

  const validatePolicy = () => {
    if (!policy.trim()) {
      toast.error("Add the return policy first.");
      return false;
    }
    return true;
  };

  const validateCase = () => {
    if (!policyHash) {
      toast.error("Publish the policy onchain before submitting the case.");
      return false;
    }
    if (!merchantResponse.trim()) {
      toast.error("Add the merchant response first.");
      return false;
    }
    if (!orderId.trim()) {
      toast.error("Add an order reference first.");
      return false;
    }
    if (!isAddress(customerAddress)) {
      toast.error("Add the customer's GenLayer wallet address.");
      return false;
    }
    if (walletAddress?.toLowerCase() === customerAddress.trim().toLowerCase()) {
      toast.error("Merchant and customer must use different wallets.");
      return false;
    }
    try {
      parseGenAmount(escrowAmount);
    } catch (error) {
      toast.error(readableWalletError(error));
      return false;
    }
    return true;
  };

  const policyExistsOnchain = async (hash: string, merchant: string) => {
    const { createClient, studionet, TransactionHashVariant } = await loadGenLayer();
    const readClient = createClient({ chain: studionet });
    const exists = await readClient.readContract({
      address: contractAddress,
      functionName: "policy_exists_for",
      args: [merchant, hash],
      transactionHashVariant: TransactionHashVariant.LATEST_NONFINAL,
    });
    return exists === true;
  };

  const checkPolicyStatus = async () => {
    if (!validatePolicy()) return;
    if (!walletAddress) {
      await connectWallet();
      return;
    }
    setPendingAction("check");
    try {
      const hash = await sha256Hex(policy.trim());
      if (await policyExistsOnchain(hash, walletAddress)) {
        setPolicyHash(hash);
        setReviewState("policy-ready");
        toast.success("This merchant wallet has committed the policy onchain.");
      } else {
        toast.info("The policy transaction is still being processed.");
      }
    } catch (error) {
      toast.error(readableWalletError(error));
    } finally {
      setPendingAction(null);
    }
  };

  const publishPolicy = async () => {
    if (!validatePolicy()) return;
    if (!walletAddress) {
      await connectWallet();
      return;
    }

    const normalizedPolicy = policy.trim();
    const hash = await sha256Hex(normalizedPolicy);
    setPolicyHash(hash);
    setPendingAction("policy");
    setReviewState("publishing-policy");

    let txHash: `0x${string}` | undefined;
    try {
      if (await policyExistsOnchain(hash, walletAddress)) {
        setReviewState("policy-ready");
        toast.success("This merchant wallet already committed the policy.");
        return;
      }

      const { createClient, studionet, ExecutionResult, TransactionStatus } = await loadGenLayer();
      const readClient = createClient({ chain: studionet });
      const client = await createWalletClient(walletAddress);
      txHash = await client.writeContract({
        address: contractAddress,
        functionName: "publish_policy",
        args: [normalizedPolicy],
        value: 0n,
        leaderOnly: true,
      });
      setPolicyTxHash(txHash);

      const receipt = await readClient.waitForTransactionReceipt({
        hash: txHash,
        status: TransactionStatus.ACCEPTED,
        interval: 2_000,
        retries: 90,
      });
      if (receipt.txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR) {
        throw new Error("The contract rejected the policy transaction.");
      }
      if (!(await policyExistsOnchain(hash, walletAddress))) {
        throw new Error("The policy is still finalizing. Check again in a moment.");
      }

      setReviewState("policy-ready");
      toast.success("Merchant policy committed. The case can now be funded.");
    } catch (error) {
      if (txHash) {
        setReviewState("publishing-policy");
        toast.error("The policy transaction was submitted and may still be processing. Check its status before continuing.");
      } else {
        setPolicyHash(null);
        setReviewState("idle");
        toast.error(readableWalletError(error));
      }
    } finally {
      setPendingAction(null);
    }
  };

  const caseExistsOnchain = async () => {
    const { createClient, studionet, TransactionHashVariant } = await loadGenLayer();
    const readClient = createClient({ chain: studionet });
    const exists = await readClient.readContract({
      address: contractAddress,
      functionName: "case_exists",
      args: [orderId.trim()],
      transactionHashVariant: TransactionHashVariant.LATEST_NONFINAL,
    });
    return exists === true;
  };

  const checkCaseStatus = async () => {
    setPendingAction("check");
    try {
      if (await caseExistsOnchain()) {
        const { createClient, studionet, TransactionHashVariant } = await loadGenLayer();
        const readClient = createClient({ chain: studionet });
        const status = await readClient.readContract({
          address: contractAddress,
          functionName: "get_case_status",
          args: [orderId.trim()],
          transactionHashVariant: TransactionHashVariant.LATEST_NONFINAL,
        });
        if (status === "AWAITING_CUSTOMER") {
          setReviewState("awaiting-customer");
          toast.success("Escrow is funded. The bound customer must accept next.");
        } else if (status === "READY") {
          setReviewState("ready");
          toast.success("Customer accepted. The case is ready for AI consensus.");
        } else if (status === "SETTLEMENT_QUEUED") {
          await checkDecision();
        } else if (status === "MANUAL_REVIEW") {
          await checkDecision();
        }
      } else {
        toast.info("The case transaction is still being processed.");
      }
    } catch (error) {
      toast.error(readableWalletError(error));
    } finally {
      setPendingAction(null);
    }
  };

  const submitCase = async () => {
    if (!validateCase()) return;
    if (!walletAddress) {
      await connectWallet();
      return;
    }

    setPendingAction("submit");
    setReviewState("funding");
    setDecision(null);
    setDecisionTxHash(null);
    setManualProposal(null);
    setManualProposalTxHash(null);
    setManualSettlementTxHash(null);

    let txHash: `0x${string}` | undefined;
    try {
      const currentPolicyHash = await sha256Hex(policy.trim());
      if (currentPolicyHash !== policyHash) {
        throw new Error("The policy changed after publication. Publish the new version before submitting the case.");
      }
      const { createClient, studionet, ExecutionResult, TransactionStatus } = await loadGenLayer();
      const readClient = createClient({ chain: studionet });
      const client = await createWalletClient(walletAddress);
      txHash = await client.writeContract({
        address: contractAddress,
        functionName: "submit_case",
        args: [
          orderId.trim(),
          category,
          policyHash,
          customerAddress.trim(),
          merchantResponse.trim(),
          evidence.trim(),
        ],
        value: parseGenAmount(escrowAmount),
        leaderOnly: true,
      });
      setCaseTxHash(txHash);

      const receipt = await readClient.waitForTransactionReceipt({
        hash: txHash,
        status: TransactionStatus.ACCEPTED,
        interval: 2_000,
        retries: 90,
      });
      if (receipt.txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR) {
        throw new Error("The contract rejected the case transaction.");
      }

      setReviewState("awaiting-customer");
      toast.success("Escrow funded. Switch to the bound customer wallet to accept the case.");
    } catch (error) {
      if (txHash) {
        setReviewState("funding");
        toast.error("The transaction was submitted but is still processing. Check its status before trying again.");
      } else {
        setReviewState("idle");
        toast.error(readableWalletError(error));
      }
    } finally {
      setPendingAction(null);
    }
  };

  const acceptCase = async () => {
    if (!walletAddress) {
      await connectWallet();
      return;
    }
    if (walletAddress.toLowerCase() !== customerAddress.trim().toLowerCase()) {
      toast.error(`Switch MetaMask to the customer wallet: ${shortAddress(customerAddress.trim())}`);
      return;
    }
    if (!customerClaim.trim()) {
      toast.error("The customer must add a claim before accepting.");
      return;
    }

    setPendingAction("accept");
    setReviewState("accepting-case");
    let txHash: `0x${string}` | undefined;
    try {
      const { createClient, studionet, ExecutionResult, TransactionStatus } = await loadGenLayer();
      const readClient = createClient({ chain: studionet });
      const client = await createWalletClient(walletAddress);
      txHash = await client.writeContract({
        address: contractAddress,
        functionName: "accept_case",
        args: [orderId.trim(), customerClaim.trim(), customerEvidence.trim()],
        value: 0n,
        leaderOnly: true,
      });
      setAcceptanceTxHash(txHash);
      const receipt = await readClient.waitForTransactionReceipt({
        hash: txHash,
        status: TransactionStatus.ACCEPTED,
        interval: 2_000,
        retries: 90,
      });
      if (receipt.txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR) {
        throw new Error("The contract rejected the customer acceptance.");
      }
      setReviewState("ready");
      toast.success("Customer identity verified. The case is ready for AI consensus.");
    } catch (error) {
      if (txHash) {
        setReviewState("accepting-case");
        toast.error("Acceptance was submitted and may still be processing. Check the case status.");
      } else {
        setReviewState("awaiting-customer");
        toast.error(readableWalletError(error));
      }
    } finally {
      setPendingAction(null);
    }
  };

  const readDecision = async () => {
    const { createClient, studionet, TransactionHashVariant } = await loadGenLayer();
    const readClient = createClient({ chain: studionet });
    const result = await readClient.readContract({
      address: contractAddress,
      functionName: "get_decision",
      args: [orderId.trim()],
      transactionHashVariant: TransactionHashVariant.LATEST_NONFINAL,
    });
    return parseDecision(result);
  };

  const readCaseStatus = async () => {
    const { createClient, studionet, TransactionHashVariant } = await loadGenLayer();
    const readClient = createClient({ chain: studionet });
    return readClient.readContract({
      address: contractAddress,
      functionName: "get_case_status",
      args: [orderId.trim()],
      transactionHashVariant: TransactionHashVariant.LATEST_NONFINAL,
    });
  };

  const readManualProposal = async () => {
    const { createClient, studionet, TransactionHashVariant } = await loadGenLayer();
    const readClient = createClient({ chain: studionet });
    const result = await readClient.readContract({
      address: contractAddress,
      functionName: "get_manual_proposal",
      args: [orderId.trim()],
      transactionHashVariant: TransactionHashVariant.LATEST_NONFINAL,
    });
    return parseManualProposal(result);
  };

  const checkDecision = async () => {
    setPendingAction("check");
    try {
      const currentDecision = await readDecision();
      if (!currentDecision) {
        toast.info("Validators are still reviewing this case.");
        return;
      }
      const status = await readCaseStatus();
      setDecision(currentDecision);
      const needsManualAgreement = currentDecision.decision === "MANUAL_REVIEW" && status === "MANUAL_REVIEW";
      setReviewState(needsManualAgreement ? "manual-review" : "resolved");
      if (needsManualAgreement) {
        setManualProposal(await readManualProposal());
      }
      toast.success(needsManualAgreement ? "Manual review is ready for a two-party settlement." : "Decision finalized and escrow settlement queued.");
    } catch (error) {
      toast.error(readableWalletError(error));
    } finally {
      setPendingAction(null);
    }
  };

  const runConsensus = async () => {
    if (!walletAddress) {
      await connectWallet();
      return;
    }

    setPendingAction("consensus");
    setReviewState("deliberating");

    let txHash: `0x${string}` | undefined;
    try {
      const { createClient, studionet, ExecutionResult, TransactionStatus } = await loadGenLayer();
      const readClient = createClient({ chain: studionet });
      const client = await createWalletClient(walletAddress);
      txHash = await client.writeContract({
        address: contractAddress,
        functionName: "adjudicate",
        args: [orderId.trim()],
        value: 0n,
      });
      setDecisionTxHash(txHash);

      const receipt = await readClient.waitForTransactionReceipt({
        hash: txHash,
        status: TransactionStatus.ACCEPTED,
        interval: 3_000,
        retries: 120,
      });
      if (receipt.txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR) {
        throw new Error("The validators could not complete this decision.");
      }

      const currentDecision = await readDecision();
      if (!currentDecision) throw new Error("The decision is finalizing. Check again in a moment.");
      setDecision(currentDecision);
      setReviewState(currentDecision.decision === "MANUAL_REVIEW" ? "manual-review" : "resolved");
      if (currentDecision.decision === "MANUAL_REVIEW") setManualProposal(await readManualProposal());
      toast.success(currentDecision.decision === "MANUAL_REVIEW" ? "Manual review: escrow remains locked for both parties." : "AI consensus finalized and routed the escrow.");
    } catch (error) {
      if (txHash) {
        setReviewState("deliberating");
        toast.error("Consensus was submitted and may still be running. Use Check decision instead of resubmitting.");
      } else {
        setReviewState("ready");
        toast.error(readableWalletError(error));
      }
    } finally {
      setPendingAction(null);
    }
  };

  const proposeManualSettlement = async () => {
    if (!walletAddress) {
      await connectWallet();
      return;
    }
    if (!manualRationale.trim()) {
      toast.error("Explain why both parties should accept this settlement.");
      return;
    }

    setPendingAction("manual-propose");
    let txHash: `0x${string}` | undefined;
    try {
      const { createClient, studionet, ExecutionResult, TransactionStatus } = await loadGenLayer();
      const readClient = createClient({ chain: studionet });
      const client = await createWalletClient(walletAddress);
      txHash = await client.writeContract({
        address: contractAddress,
        functionName: "propose_manual_settlement",
        args: [orderId.trim(), manualRecipient, manualRationale.trim()],
        value: 0n,
        leaderOnly: true,
      });
      setManualProposalTxHash(txHash);
      const receipt = await readClient.waitForTransactionReceipt({
        hash: txHash,
        status: TransactionStatus.ACCEPTED,
        interval: 2_000,
        retries: 90,
      });
      if (receipt.txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR) {
        throw new Error("The contract rejected the manual settlement proposal.");
      }
      const proposal = await readManualProposal();
      if (!proposal) throw new Error("The proposal is still finalizing. Check again in a moment.");
      setManualProposal(proposal);
      toast.success("Settlement proposal recorded. The other bound party must confirm it.");
    } catch (error) {
      toast.error(txHash ? "The proposal was submitted and may still be processing. Check the case again." : readableWalletError(error));
    } finally {
      setPendingAction(null);
    }
  };

  const confirmManualSettlement = async () => {
    if (!walletAddress) {
      await connectWallet();
      return;
    }
    if (!manualProposal) {
      toast.error("No manual settlement proposal is available yet.");
      return;
    }
    if (manualProposal.proposer.toLowerCase() === walletAddress.toLowerCase()) {
      toast.error("Switch to the other bound party's wallet to confirm this proposal.");
      return;
    }

    setPendingAction("manual-confirm");
    let txHash: `0x${string}` | undefined;
    try {
      const { createClient, studionet, ExecutionResult, TransactionStatus } = await loadGenLayer();
      const readClient = createClient({ chain: studionet });
      const client = await createWalletClient(walletAddress);
      txHash = await client.writeContract({
        address: contractAddress,
        functionName: "confirm_manual_settlement",
        args: [orderId.trim()],
        value: 0n,
        leaderOnly: true,
      });
      setManualSettlementTxHash(txHash);
      const receipt = await readClient.waitForTransactionReceipt({
        hash: txHash,
        status: TransactionStatus.ACCEPTED,
        interval: 2_000,
        retries: 90,
      });
      if (receipt.txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR) {
        throw new Error("The contract rejected the manual settlement confirmation.");
      }
      const currentDecision = await readDecision();
      if (!currentDecision || currentDecision.settlement === "LOCKED_PENDING_BOTH_PARTIES") {
        throw new Error("The settlement is still finalizing. Check again in a moment.");
      }
      setDecision(currentDecision);
      setReviewState("resolved");
      toast.success("Both parties agreed. The escrow settlement is queued.");
    } catch (error) {
      toast.error(txHash ? "Confirmation was submitted and may still be processing. Check the decision again." : readableWalletError(error));
    } finally {
      setPendingAction(null);
    }
  };

  const handlePrimaryAction = async () => {
    if (!walletAddress) {
      await connectWallet();
      return;
    }
    if (reviewState === "publishing-policy") {
      await checkPolicyStatus();
      return;
    }
    if (reviewState === "idle") {
      await publishPolicy();
      return;
    }
    if (reviewState === "policy-ready") {
      await submitCase();
      return;
    }
    if (reviewState === "funding" || reviewState === "accepting-case") {
      await checkCaseStatus();
      return;
    }
    if (reviewState === "awaiting-customer") {
      await acceptCase();
      return;
    }
    if (reviewState === "ready") {
      await runConsensus();
      return;
    }
    if (reviewState === "deliberating") {
      await checkDecision();
      return;
    }
  };

  const primaryLabel = () => {
    if (pendingAction === "wallet") return "Connecting wallet";
    if (pendingAction === "policy") return "Publishing policy";
    if (pendingAction === "submit") return "Funding escrow";
    if (pendingAction === "accept") return "Accepting as customer";
    if (pendingAction === "consensus") return "Starting consensus";
    if (pendingAction === "check") return "Checking chain";
    if (!walletAddress) return "Connect wallet";
    if (reviewState === "idle") return "Publish policy onchain";
    if (reviewState === "publishing-policy") return "Check policy status";
    if (reviewState === "policy-ready") return "Fund case escrow";
    if (reviewState === "funding" || reviewState === "accepting-case") return "Check case status";
    if (reviewState === "awaiting-customer") {
      return walletAddress?.toLowerCase() === customerAddress.trim().toLowerCase()
        ? "Accept as customer"
        : "Switch to customer wallet";
    }
    if (reviewState === "ready") return "Run AI consensus";
    if (reviewState === "deliberating") return "Check decision";
    if (reviewState === "manual-review") return "Escrow locked for agreement";
    return "Escrow settlement queued";
  };

  const completedStages: Record<ReviewState, number> = {
    idle: 0,
    "publishing-policy": 0,
    "policy-ready": 1,
    funding: 1,
    "awaiting-customer": 2,
    "accepting-case": 2,
    ready: 3,
    deliberating: 3,
    resolved: 5,
    "manual-review": 4,
  };
  const activeStageByState: Record<ReviewState, number | null> = {
    idle: null,
    "publishing-policy": 0,
    "policy-ready": null,
    funding: 1,
    "awaiting-customer": 2,
    "accepting-case": 2,
    ready: 3,
    deliberating: 3,
    resolved: null,
    "manual-review": 4,
  };
  const activeStage = activeStageByState[reviewState];
  const formLocked = ["funding", "awaiting-customer", "accepting-case", "ready", "deliberating", "resolved", "manual-review"].includes(reviewState);
  const customerFieldsLocked = ["funding", "accepting-case", "ready", "deliberating", "resolved", "manual-review"].includes(reviewState);
  const policyLocked = reviewState === "publishing-policy" || formLocked;

  return (
    <main className="min-h-screen overflow-hidden bg-[#07100d] text-[#eef7f2]">
      <Toaster position="top-right" richColors />

      <div className="docket-grid fixed inset-0 pointer-events-none opacity-50" />
      <div className="glow-orb fixed -right-44 -top-44 h-[34rem] w-[34rem] rounded-full bg-[#b6ff4a]/10 blur-[120px]" />

      <header className="relative z-10 border-b border-white/10 bg-[#07100d]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1480px] items-center justify-between px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="brand-mark flex size-10 items-center justify-center rounded-xl border border-[#b6ff4a]/35 bg-[#b6ff4a]/10">
              <ShieldCheck className="size-5 text-[#b6ff4a]" strokeWidth={2.2} />
            </div>
            <div>
              <p className="text-[1.05rem] font-semibold tracking-[-0.02em]">ReturnGuard</p>
              <p className="text-xs text-[#8da198]">Autonomous dispute resolution</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge className="hidden border-[#b6ff4a]/20 bg-[#b6ff4a]/10 text-[#caff80] sm:inline-flex">
              <Sparkles className="size-3" /> Built on GenLayer
            </Badge>
            <Badge variant="outline" className="border-[#b6ff4a]/30 bg-[#b6ff4a]/5 text-[#b6ff4a]">
              <span className="size-1.5 rounded-full bg-[#b6ff4a] shadow-[0_0_10px_#b6ff4a]" />
              Studionet live
            </Badge>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pendingAction === "wallet"}
              onClick={connectWallet}
              className="h-9 rounded-lg border-white/15 bg-white/[0.035] px-3 text-[#d9e6df] hover:border-[#b6ff4a]/35 hover:bg-[#b6ff4a]/8 hover:text-white"
            >
              {pendingAction === "wallet" ? <LoaderCircle className="size-4 animate-spin" /> : <Wallet className="size-4 text-[#b6ff4a]" />}
              <span className="hidden sm:inline">{walletAddress ? shortAddress(walletAddress) : "Connect wallet"}</span>
            </Button>
          </div>
        </div>
      </header>

      <div className="relative z-10 mx-auto max-w-[1480px] px-5 py-7 sm:px-8 lg:py-10">
        <section className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <div className="mb-3 flex items-center gap-2 text-sm text-[#b6ff4a]">
              <span className="inline-block h-px w-8 bg-[#b6ff4a]" />
              Case adjudication workspace
            </div>
            <h1 className="max-w-3xl text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl lg:text-[2.85rem] lg:leading-[1.05]">
              Turn return disputes into verifiable decisions.
            </h1>
          </div>
          <p className="max-w-md text-[15px] leading-6 text-[#94a79e]">
            The merchant commits a policy and funds GEN escrow. The bound customer accepts separately, then validator consensus routes the funds.
          </p>
        </section>

        <section className="mb-5 flex flex-col gap-4 rounded-2xl border border-[#b6ff4a]/15 bg-[#0b1713]/80 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#b6ff4a]/10 text-[#b6ff4a]">
              <ShieldCheck className="size-[18px]" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-white">Intelligent Contract deployed and verified</p>
              <p className="mt-1 truncate font-mono text-xs text-[#7f9389]">{contractAddress}</p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <a
              href={`${explorerBase}/${deploymentTx}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 px-3 text-xs font-medium text-[#a9bbb1] transition-colors hover:border-white/20 hover:text-white"
            >
              Deployment <ExternalLink className="size-3.5" />
            </a>
            <a
              href={`${contractExplorerBase}/${contractAddress}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#b6ff4a]/20 bg-[#b6ff4a]/5 px-3 text-xs font-medium text-[#caff80] transition-colors hover:bg-[#b6ff4a]/10"
            >
              Contract <ExternalLink className="size-3.5" />
            </a>
          </div>
        </section>

        {walletNotice && (
          <section
            role="alert"
            aria-live="polite"
            className="mb-5 flex flex-col gap-3 rounded-2xl border border-[#ffb367]/25 bg-[#ff9b3f]/8 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5"
          >
            <div className="flex items-start gap-3">
              <CircleAlert className="mt-0.5 size-[18px] shrink-0 text-[#ffb367]" />
              <div>
                <p className="text-sm font-medium text-white">Wallet connection needs attention</p>
                <p className="mt-1 text-sm leading-5 text-[#c7b7a6]">{walletNotice}</p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2 pl-[30px] sm:pl-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={connectWallet}
                disabled={pendingAction === "wallet"}
                className="border-[#ffb367]/25 bg-transparent text-[#ffd1a5] hover:bg-[#ff9b3f]/10 hover:text-white"
              >
                Try again
              </Button>
              <a
                href={siteUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-xs font-medium text-[#d7e3dc] transition-colors hover:border-white/20 hover:text-white"
              >
                Open in new tab <ExternalLink className="size-3.5" />
              </a>
            </div>
          </section>
        )}

        <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
          <section className="panel-shell rounded-[1.4rem] border border-white/10 bg-[#0b1713]/90 p-4 shadow-2xl shadow-black/20 sm:p-6">
            <div className="mb-6 flex items-start justify-between gap-4 border-b border-white/8 pb-5">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-lg bg-white/5 text-[#c1d0c8]">
                  <FileText className="size-[18px]" />
                </div>
                <div>
                  <h2 className="font-medium text-white">New dispute</h2>
                  <p className="mt-0.5 text-sm text-[#7f9389]">Two wallets, separate claims, one funded settlement.</p>
                </div>
              </div>
              <Badge variant="outline" className="border-white/10 font-mono text-[#7f9389]">
                CASE / {orderId || "NEW"}
              </Badge>
            </div>

            <div className="grid gap-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Order reference" htmlFor="order-id">
                  <Input
                    id="order-id"
                    value={orderId}
                    onChange={(event) => setOrderId(event.target.value)}
                    disabled={formLocked}
                    className="h-11 border-white/10 bg-black/15 text-white placeholder:text-[#617168] focus-visible:border-[#b6ff4a]/60 focus-visible:ring-[#b6ff4a]/15"
                  />
                </Field>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-[#cad8d0]" htmlFor="category">
                    Product category
                  </label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger disabled={formLocked} id="category" className="h-11 w-full border-white/10 bg-black/15 text-white focus-visible:border-[#b6ff4a]/60 focus-visible:ring-[#b6ff4a]/15">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-white/10 bg-[#102019] text-white">
                      <SelectItem value="electronics">Electronics</SelectItem>
                      <SelectItem value="beauty">Beauty & personal care</SelectItem>
                      <SelectItem value="fashion">Fashion</SelectItem>
                      <SelectItem value="home">Home & living</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-[1.45fr_0.55fr]">
                <Field label="Customer wallet" htmlFor="customer-wallet" hint="Must differ from the merchant wallet">
                  <Input
                    id="customer-wallet"
                    value={customerAddress}
                    onChange={(event) => setCustomerAddress(event.target.value)}
                    disabled={formLocked}
                    placeholder="0x..."
                    className="h-11 border-white/10 bg-black/15 font-mono text-white placeholder:text-[#617168] focus-visible:border-[#b6ff4a]/60 focus-visible:ring-[#b6ff4a]/15"
                  />
                </Field>
                <Field label="Escrow (test GEN)" htmlFor="escrow-amount">
                  <Input
                    id="escrow-amount"
                    inputMode="decimal"
                    value={escrowAmount}
                    onChange={(event) => setEscrowAmount(event.target.value)}
                    disabled={formLocked}
                    className="h-11 border-white/10 bg-black/15 text-white placeholder:text-[#617168] focus-visible:border-[#b6ff4a]/60 focus-visible:ring-[#b6ff4a]/15"
                  />
                </Field>
              </div>

              <Field label="Return policy" htmlFor="policy" hint="The rulebook validators must apply">
                <Textarea
                  id="policy"
                  value={policy}
                  onChange={(event) => {
                    setPolicy(event.target.value);
                    if (reviewState === "policy-ready") {
                      setPolicyHash(null);
                      setPolicyTxHash(null);
                      setReviewState("idle");
                    }
                  }}
                  disabled={policyLocked}
                  className="min-h-24 resize-none border-white/10 bg-black/15 leading-6 text-white placeholder:text-[#617168] focus-visible:border-[#b6ff4a]/60 focus-visible:ring-[#b6ff4a]/15"
                />
              </Field>

              <div className="rounded-xl border border-[#b6ff4a]/15 bg-[#b6ff4a]/[0.035] px-3.5 py-3">
                <div className="flex items-start gap-2.5">
                  <LockKeyhole className="mt-0.5 size-4 shrink-0 text-[#b6ff4a]" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#dce9e2]">
                      {policyHash && reviewState !== "publishing-policy" ? "Policy published before case" : "Policy must be published first"}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-[#789086]">
                      {policyHash
                        ? `SHA-256 ${policyHash}`
                        : "The contract records the policy in a separate transaction. The case later references only its SHA-256 hash."}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Field label="Customer claim" htmlFor="customer-claim">
                  <Textarea
                    id="customer-claim"
                    value={customerClaim}
                    onChange={(event) => setCustomerClaim(event.target.value)}
                    disabled={customerFieldsLocked}
                    className="min-h-32 resize-none border-white/10 bg-black/15 leading-6 text-white placeholder:text-[#617168] focus-visible:border-[#b6ff4a]/60 focus-visible:ring-[#b6ff4a]/15"
                  />
                </Field>
                <Field label="Merchant response" htmlFor="merchant-response">
                  <Textarea
                    id="merchant-response"
                    value={merchantResponse}
                    onChange={(event) => setMerchantResponse(event.target.value)}
                    disabled={formLocked}
                    className="min-h-32 resize-none border-white/10 bg-black/15 leading-6 text-white placeholder:text-[#617168] focus-visible:border-[#b6ff4a]/60 focus-visible:ring-[#b6ff4a]/15"
                  />
                </Field>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Field label="Customer evidence" htmlFor="customer-evidence" hint="Submitted by the bound customer">
                  <Textarea
                    id="customer-evidence"
                    value={customerEvidence}
                    onChange={(event) => setCustomerEvidence(event.target.value)}
                    disabled={customerFieldsLocked}
                    className="min-h-24 resize-none border-white/10 bg-black/15 leading-6 text-white placeholder:text-[#617168] focus-visible:border-[#b6ff4a]/60 focus-visible:ring-[#b6ff4a]/15"
                  />
                </Field>
                <Field label="Merchant evidence" htmlFor="evidence" hint="Submitted when escrow is funded">
                  <Textarea
                    id="evidence"
                    value={evidence}
                    onChange={(event) => setEvidence(event.target.value)}
                    disabled={formLocked}
                    className="min-h-24 resize-none border-white/10 bg-black/15 leading-6 text-white placeholder:text-[#617168] focus-visible:border-[#b6ff4a]/60 focus-visible:ring-[#b6ff4a]/15"
                  />
                </Field>
              </div>

              <div className="flex flex-col gap-3 border-t border-white/8 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 text-sm text-[#81958a]">
                  <LockKeyhole className="size-4 text-[#b6ff4a]" />
                  Only the policy-owning merchant can fund; only the named customer can accept.
                </div>
                <Button
                  type="button"
                  size="lg"
                  disabled={pendingAction !== null || reviewState === "resolved" || reviewState === "manual-review"}
                  onClick={handlePrimaryAction}
                  className="h-11 rounded-xl bg-[#b6ff4a] px-5 font-semibold text-[#0a120f] shadow-[0_0_30px_rgba(182,255,74,0.13)] hover:bg-[#c8ff78]"
                >
                  {pendingAction ? <LoaderCircle className="size-4 animate-spin" /> : reviewState === "ready" ? <BrainCircuit className="size-4" /> : reviewState === "deliberating" ? <Circle className="size-4" /> : reviewState === "idle" || reviewState === "publishing-policy" ? <LockKeyhole className="size-4" /> : <Send className="size-4" />}
                  {primaryLabel()}
                  {!pendingAction && reviewState !== "deliberating" && reviewState !== "manual-review" && <ArrowRight className="size-4" />}
                </Button>
              </div>

              {(policyTxHash || caseTxHash || acceptanceTxHash || decisionTxHash || manualProposalTxHash || manualSettlementTxHash) && (
                <div className="grid gap-2 rounded-xl border border-white/8 bg-black/15 p-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
                  {policyTxHash && (
                    <TransactionLink label="Policy transaction" hash={policyTxHash} />
                  )}
                  {caseTxHash && (
                    <TransactionLink label="Escrow transaction" hash={caseTxHash} />
                  )}
                  {acceptanceTxHash && (
                    <TransactionLink label="Customer acceptance" hash={acceptanceTxHash} />
                  )}
                  {decisionTxHash && (
                    <TransactionLink label="Consensus transaction" hash={decisionTxHash} />
                  )}
                  {manualProposalTxHash && (
                    <TransactionLink label="Settlement proposal" hash={manualProposalTxHash} />
                  )}
                  {manualSettlementTxHash && (
                    <TransactionLink label="Settlement confirmation" hash={manualSettlementTxHash} />
                  )}
                </div>
              )}
            </div>
          </section>

          <aside className="space-y-5">
            <section className="panel-shell rounded-[1.4rem] border border-white/10 bg-[#0b1713]/90 p-5 shadow-2xl shadow-black/20 sm:p-6">
              <div className="mb-6 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-[#b6ff4a]/10 text-[#b6ff4a]">
                    <Network className="size-[18px]" />
                  </div>
                  <div>
                    <h2 className="font-medium text-white">Consensus docket</h2>
                    <p className="mt-0.5 text-sm text-[#7f9389]">Five independent GenLayer validators</p>
                  </div>
                </div>
                <span className={`status-pulse ${reviewState === "idle" ? "is-idle" : ""}`} aria-hidden="true" />
              </div>

              <Progress value={progressByState[reviewState]} className="mb-6 h-1.5 bg-white/8 [&_[data-slot=progress-indicator]]:bg-[#b6ff4a]" />

              <div className="space-y-1">
                {stages.map((stage, index) => {
                  const isComplete = index < completedStages[reviewState];
                  const isActive = index === activeStage;

                  return (
                    <div key={stage.id} className={`stage-row ${isActive ? "is-active" : ""}`}>
                      <div className="relative flex w-8 shrink-0 justify-center">
                        {index < stages.length - 1 && <span className="absolute left-1/2 top-6 h-10 w-px -translate-x-1/2 bg-white/10" />}
                        <div className={`stage-icon ${isComplete ? "is-complete" : isActive ? "is-active" : ""}`}>
                          {isComplete ? <Check className="size-3.5" /> : <Circle className="size-3" />}
                        </div>
                      </div>
                      <div className="pb-6">
                        <p className={`text-sm font-medium ${isActive || isComplete ? "text-white" : "text-[#6f8178]"}`}>{stage.label}</p>
                        <p className="mt-1 text-xs text-[#6f8178]">{stage.detail}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className={`decision-card rounded-[1.4rem] border p-5 sm:p-6 ${reviewState === "resolved" || reviewState === "manual-review" ? "is-resolved" : ""}`}>
              {(reviewState === "resolved" || reviewState === "manual-review") && decision ? (
                <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                  <div className="mb-5 flex items-start justify-between gap-3">
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#ffb367]">
                        {reviewState === "manual-review" ? "AI decision · agreement required" : "Final decision"}
                      </p>
                      <h2 className="text-2xl font-semibold tracking-[-0.03em] text-white">{decisionTitle(decision)}</h2>
                    </div>
                    <div className="consensus-seal flex size-14 items-center justify-center rounded-full border border-[#ff9b3f]/40 bg-[#ff9b3f]/10">
                      <Scale className="size-6 text-[#ffad5f]" />
                    </div>
                  </div>

                  <p className="border-l-2 border-[#ff9b3f]/70 pl-4 text-[15px] leading-6 text-[#c8d5ce]">
                    {decision.rationale}
                  </p>

                  <p className="mt-4 rounded-lg border border-white/8 bg-black/15 px-3 py-2.5 text-xs text-[#90a299]">
                    Key fact: <span className="font-medium text-[#d7e3dc]">{decision.key_fact}</span>
                  </p>

                  <p className="mt-3 rounded-lg border border-[#b6ff4a]/15 bg-[#b6ff4a]/[0.04] px-3 py-2.5 text-xs leading-5 text-[#a9bbb1]">
                    {decision.settlement === "CUSTOMER"
                      ? `Escrow: ${escrowAmount} test GEN is queued for the customer when this transaction finalizes.`
                      : decision.settlement === "MERCHANT"
                        ? `Escrow: ${escrowAmount} test GEN is queued back to the merchant when this transaction finalizes.`
                        : "Escrow remains locked. A manual settlement requires a proposal from one bound party and confirmation by the other."}
                  </p>

                  {reviewState === "manual-review" && (
                    <div className="mt-4 space-y-3 rounded-xl border border-[#41d6ff]/20 bg-[#41d6ff]/[0.035] p-4">
                      <div>
                        <p className="text-sm font-semibold text-white">Resolve with both parties</p>
                        <p className="mt-1 text-xs leading-5 text-[#91a79d]">
                          A bound party records the recipient and rationale onchain. The other bound party must confirm the exact proposal before escrow moves.
                        </p>
                      </div>

                      {manualProposal && (
                        <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs leading-5 text-[#b8c8c0]">
                          <p>
                            Proposed recipient: <span className="font-semibold text-white">{manualProposal.recipient === "CUSTOMER" ? "Customer" : "Merchant"}</span>
                          </p>
                          <p className="mt-1">{manualProposal.rationale}</p>
                          <p className="mt-2 font-mono text-[11px] text-[#71877c]">Proposed by {shortAddress(manualProposal.proposer)}</p>
                        </div>
                      )}

                      <div className="grid gap-3 sm:grid-cols-[0.8fr_1.2fr]">
                        <Select
                          value={manualRecipient}
                          onValueChange={(value) => setManualRecipient(value as "CUSTOMER" | "MERCHANT")}
                          disabled={pendingAction !== null}
                        >
                          <SelectTrigger className="border-white/10 bg-black/15 text-white">
                            <SelectValue aria-label="Settlement recipient" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="CUSTOMER">Pay customer</SelectItem>
                            <SelectItem value="MERCHANT">Return to merchant</SelectItem>
                          </SelectContent>
                        </Select>
                        <Textarea
                          value={manualRationale}
                          onChange={(event) => setManualRationale(event.target.value)}
                          disabled={pendingAction !== null}
                          maxLength={1000}
                          placeholder="Explain the agreed settlement basis."
                          aria-label="Manual settlement rationale"
                          className="min-h-20 resize-none border-white/10 bg-black/15 text-white placeholder:text-[#617168] focus-visible:border-[#41d6ff]/60 focus-visible:ring-[#41d6ff]/15"
                        />
                      </div>

                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={pendingAction !== null}
                          onClick={proposeManualSettlement}
                          className="border-[#41d6ff]/30 bg-[#41d6ff]/5 text-[#8be7ff] hover:bg-[#41d6ff]/10 hover:text-white"
                        >
                          {pendingAction === "manual-propose" ? <LoaderCircle className="size-4 animate-spin" /> : <FileText className="size-4" />}
                          Record proposal
                        </Button>
                        {manualProposal && (
                          <Button
                            type="button"
                            disabled={pendingAction !== null}
                            onClick={confirmManualSettlement}
                            className="bg-[#b6ff4a] font-semibold text-[#0a120f] hover:bg-[#c8ff78]"
                          >
                            {pendingAction === "manual-confirm" ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
                            Confirm & release escrow
                          </Button>
                        )}
                      </div>
                    </div>
                  )}

                  {decision.manual_rationale && (
                    <div className="mt-4 rounded-xl border border-[#41d6ff]/20 bg-[#41d6ff]/[0.035] p-3 text-xs leading-5 text-[#b8c8c0]">
                      <p className="font-semibold text-[#8be7ff]">Two-party manual resolution</p>
                      <p className="mt-1">{decision.manual_rationale}</p>
                      <p className="mt-2 text-[#71877c]">Proposed and confirmed by the bound parties onchain.</p>
                    </div>
                  )}

                  <div className="mt-6 grid grid-cols-3 divide-x divide-white/10 rounded-xl border border-white/10 bg-black/15 py-4 text-center">
                    <Metric value="3 / 5" label="Quorum" />
                    <Metric value="Full AI" label="Consensus" />
                    <Metric
                      value={decision.settlement === "CUSTOMER" ? "Customer" : decision.settlement === "MERCHANT" ? "Merchant" : "Locked"}
                      label="Escrow"
                    />
                  </div>

                  {decisionTxHash && (
                    <a
                      href={`${explorerBase}/${decisionTxHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-5 flex items-center gap-2 text-xs text-[#9cb0a5] transition-colors hover:text-[#b6ff4a]"
                    >
                      <FileCheck2 className="size-4 text-[#b6ff4a]" />
                      View the finalized validator decision
                      <ExternalLink className="ml-auto size-3.5" />
                    </a>
                  )}
                </div>
              ) : (
                <div className="flex min-h-[15.5rem] flex-col items-center justify-center px-5 text-center">
                  <div className="mb-4 flex size-14 items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.025]">
                    <Scale className="size-6 text-[#53665d]" />
                  </div>
                  <h2 className="font-medium text-[#c6d4cc]">No decision yet</h2>
                  <p className="mt-2 max-w-sm text-sm leading-6 text-[#71847a]">
                    {reviewState === "ready"
                      ? "Both wallet roles are verified. Either bound party can now start AI consensus."
                      : reviewState === "deliberating"
                        ? "The transaction is live. Validators are independently reviewing the policy and evidence."
                        : reviewState === "awaiting-customer"
                          ? `Escrow is funded. Switch MetaMask to ${customerAddress ? shortAddress(customerAddress) : "the bound customer"} and accept the case.`
                          : reviewState === "funding" || reviewState === "accepting-case"
                            ? "The signed role or escrow transaction is being recorded on GenLayer."
                          : reviewState === "policy-ready"
                            ? "The merchant policy is locked onchain. Name the customer and fund the case escrow."
                            : reviewState === "publishing-policy"
                              ? "The merchant's policy commitment is being recorded before the case exists."
                              : "Connect the merchant wallet and publish its return policy before funding a dispute."}
                  </p>
                </div>
              )}
            </section>

            <div className="grid grid-cols-2 gap-3">
              <ProtocolCard icon={<Scale className="size-4" />} title="Role-bound" copy="Merchant and customer sign separately." />
              <ProtocolCard icon={<ShieldCheck className="size-4" />} title="GEN escrow" copy="The decision moves testnet funds." />
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm font-medium text-[#cad8d0]" htmlFor={htmlFor}>
          {label}
        </label>
        {hint && <span className="hidden text-xs text-[#63766c] sm:block">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="px-2">
      <p className="text-base font-semibold text-white sm:text-lg">{value}</p>
      <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-[#72857b]">{label}</p>
    </div>
  );
}

function ProtocolCard({ icon, title, copy }: { icon: React.ReactNode; title: string; copy: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-[#0a1511]/80 p-4">
      <div className="mb-3 flex size-8 items-center justify-center rounded-lg bg-white/5 text-[#9fb2a8]">{icon}</div>
      <p className="text-sm font-medium text-[#d6e2dc]">{title}</p>
      <p className="mt-1 text-xs leading-5 text-[#687b71]">{copy}</p>
    </div>
  );
}

function TransactionLink({ label, hash }: { label: string; hash: string }) {
  return (
    <a
      href={`${explorerBase}/${hash}`}
      target="_blank"
      rel="noreferrer"
      className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-[#91a59a] transition-colors hover:bg-white/5 hover:text-[#b6ff4a]"
    >
      <FileCheck2 className="size-3.5 shrink-0 text-[#b6ff4a]" />
      <span className="truncate">{label}</span>
      <ExternalLink className="ml-auto size-3.5 shrink-0" />
    </a>
  );
}
