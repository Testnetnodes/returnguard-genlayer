import pytest


SDK_VERSION = "v0.2.16"


def test_submit_and_read_case(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/return_guard.py", sdk_version=SDK_VERSION)
    direct_vm.sender = direct_alice

    contract.submit_case(
        "RG-1001",
        "electronics",
        "Unused products may be returned within 14 days.",
        "The buyer says the device was only opened for inspection.",
        "The merchant says the device activation log shows six hours of use.",
        "A timestamped activation log and packaging photos were submitted.",
    )

    assert contract.case_exists("RG-1001") is True
    assert "RG-1001" in contract.get_case("RG-1001")
    assert contract.get_decision("RG-1001") == ""


def test_unknown_case(direct_vm, direct_deploy):
    contract = direct_deploy("contracts/return_guard.py", sdk_version=SDK_VERSION)

    assert contract.case_exists("missing") is False
    assert contract.get_case("missing") == ""
    assert contract.get_decision("missing") == ""


def test_multiple_cases_are_kept_independently(direct_vm, direct_deploy):
    contract = direct_deploy("contracts/return_guard.py", sdk_version=SDK_VERSION)

    contract.submit_case(
        "RG-2001",
        "electronics",
        "Unused products may be returned within 14 days.",
        "The buyer says the product was unused.",
        "The merchant says the seal was broken.",
        "Packaging photos were submitted.",
    )
    contract.submit_case(
        "RG-2002",
        "apparel",
        "Unworn items may be returned within 30 days.",
        "The buyer says the item was only tried on.",
        "The merchant says the tags were removed.",
        "The return inspection report was submitted.",
    )

    assert "RG-2001" in contract.get_case("RG-2001")
    assert "RG-2002" in contract.get_case("RG-2002")


def test_adjudicated_case_cannot_be_retried(direct_vm, direct_deploy):
    contract = direct_deploy("contracts/return_guard.py", sdk_version=SDK_VERSION)
    contract.submit_case(
        "RG-LOCKED",
        "electronics",
        "Unused products may be returned within 14 days.",
        "The buyer requests a refund.",
        "The merchant rejects the request.",
        "Both parties submitted evidence.",
    )
    contract.decisions["RG-LOCKED"] = '{"decision":"REFUND_REJECTED"}'

    with pytest.raises(Exception, match="case already adjudicated"):
        contract.adjudicate("RG-LOCKED")
