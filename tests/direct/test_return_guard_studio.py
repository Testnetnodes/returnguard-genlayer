def test_submit_and_read_case(direct_deploy):
    contract = direct_deploy("contracts/return_guard_studio.py")

    contract.submit_case(
        "RG-1001",
        "Electronics",
        "Returns require an unopened box within 14 days.",
        "The customer says the item was only inspected.",
        "The merchant says the seal was broken.",
        "Photos show a broken seal and intact product.",
    )

    assert contract.case_exists("RG-1001") is True
    assert "broken seal" in contract.get_case("RG-1001")
    assert contract.get_decision("RG-1001") == ""


def test_unknown_case(direct_deploy):
    contract = direct_deploy("contracts/return_guard_studio.py")

    assert contract.case_exists("missing") is False
    assert contract.get_case("missing") == ""
    assert contract.get_decision("missing") == ""
