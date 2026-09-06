def test_submit_and_read_case(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/return_guard.py")
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
    contract = direct_deploy("contracts/return_guard.py")

    assert contract.case_exists("missing") is False
    assert contract.get_case("missing") == ""
    assert contract.get_decision("missing") == ""
