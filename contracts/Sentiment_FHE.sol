pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract SentimentFHE is ZamaEthereumConfig {
    struct SentimentEntry {
        euint32 encryptedScore;
        uint256 departmentId;
        uint256 timestamp;
        uint32 decryptedScore;
        bool isVerified;
    }

    struct Department {
        string name;
        uint256 totalScore;
        uint256 entryCount;
    }

    mapping(uint256 => SentimentEntry) public sentimentEntries;
    mapping(uint256 => Department) public departments;
    uint256[] public entryIds;
    uint256[] public departmentIds;

    event SentimentRecorded(uint256 indexed entryId, uint256 departmentId);
    event DecryptionVerified(uint256 indexed entryId, uint32 decryptedScore);
    event DepartmentCreated(uint256 indexed departmentId, string name);

    constructor() ZamaEthereumConfig() {
        _createDepartment(0, "Default");
    }

    function _createDepartment(uint256 departmentId, string memory name) private {
        require(departments[departmentId].entryCount == 0, "Department already exists");
        departments[departmentId] = Department(name, 0, 0);
        departmentIds.push(departmentId);
        emit DepartmentCreated(departmentId, name);
    }

    function recordSentiment(
        uint256 departmentId,
        externalEuint32 encryptedScore,
        bytes calldata inputProof
    ) external {
        require(departments[departmentId].entryCount > 0, "Department does not exist");
        require(FHE.isInitialized(FHE.fromExternal(encryptedScore, inputProof)), "Invalid encrypted input");

        uint256 entryId = entryIds.length;
        sentimentEntries[entryId] = SentimentEntry({
            encryptedScore: FHE.fromExternal(encryptedScore, inputProof),
            departmentId: departmentId,
            timestamp: block.timestamp,
            decryptedScore: 0,
            isVerified: false
        });

        FHE.allowThis(sentimentEntries[entryId].encryptedScore);
        FHE.makePubliclyDecryptable(sentimentEntries[entryId].encryptedScore);

        entryIds.push(entryId);
        emit SentimentRecorded(entryId, departmentId);
    }

    function verifyDecryption(
        uint256 entryId,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(entryId < entryIds.length, "Invalid entry ID");
        require(!sentimentEntries[entryId].isVerified, "Data already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(sentimentEntries[entryId].encryptedScore);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);

        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        uint256 departmentId = sentimentEntries[entryId].departmentId;

        sentimentEntries[entryId].decryptedScore = decodedValue;
        sentimentEntries[entryId].isVerified = true;

        departments[departmentId].totalScore += decodedValue;
        departments[departmentId].entryCount++;

        emit DecryptionVerified(entryId, decodedValue);
    }

    function getDepartmentStats(uint256 departmentId) external view returns (uint256 averageScore) {
        require(departments[departmentId].entryCount > 0, "Department does not exist");
        return departments[departmentId].totalScore / departments[departmentId].entryCount;
    }

    function getSentimentEntry(uint256 entryId) external view returns (
        uint256 departmentId,
        uint256 timestamp,
        bool isVerified,
        uint32 decryptedScore
    ) {
        require(entryId < entryIds.length, "Invalid entry ID");
        SentimentEntry storage entry = sentimentEntries[entryId];
        return (entry.departmentId, entry.timestamp, entry.isVerified, entry.decryptedScore);
    }

    function getAllEntryIds() external view returns (uint256[] memory) {
        return entryIds;
    }

    function getAllDepartmentIds() external view returns (uint256[] memory) {
        return departmentIds;
    }

    function createDepartment(uint256 departmentId, string calldata name) external {
        _createDepartment(departmentId, name);
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}


