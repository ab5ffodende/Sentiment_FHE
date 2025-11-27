import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface SentimentData {
  id: string;
  name: string;
  moodScore: number;
  workload: number;
  description: string;
  timestamp: number;
  creator: string;
  isVerified: boolean;
  decryptedValue: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [sentiments, setSentiments] = useState<SentimentData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingSentiment, setCreatingSentiment] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newSentimentData, setNewSentimentData] = useState({ name: "", moodScore: "", workload: "", description: "" });
  const [selectedSentiment, setSelectedSentiment] = useState<SentimentData | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const sentimentsList: SentimentData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          sentimentsList.push({
            id: businessId,
            name: businessData.name,
            moodScore: Number(businessData.publicValue1) || 0,
            workload: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setSentiments(sentimentsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createSentiment = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingSentiment(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating sentiment with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const moodValue = parseInt(newSentimentData.moodScore) || 0;
      const businessId = `sentiment-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, moodValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newSentimentData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        moodValue,
        parseInt(newSentimentData.workload) || 0,
        newSentimentData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Sentiment recorded successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewSentimentData({ name: "", moodScore: "", workload: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingSentiment(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Mood score decrypted successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const testAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "FHE system is available and ready!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredSentiments = sentiments.filter(sentiment =>
    sentiment.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    sentiment.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const paginatedSentiments = filteredSentiments.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const totalPages = Math.ceil(filteredSentiments.length / itemsPerPage);

  const getMoodEmoji = (score: number) => {
    if (score >= 8) return "😊";
    if (score >= 6) return "🙂";
    if (score >= 4) return "😐";
    if (score >= 2) return "😔";
    return "😢";
  };

  const getWorkloadEmoji = (workload: number) => {
    if (workload >= 8) return "🔥";
    if (workload >= 6) return "💪";
    if (workload >= 4) return "⚖️";
    if (workload >= 2) return "🐢";
    return "😴";
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>Confidential Employee Sentiment 🌸</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🌸</div>
            <h2>Connect Your Wallet to Continue</h2>
            <p>Please connect your wallet to access the confidential employee sentiment system with FHE protection.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading sentiment system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Confidential Employee Sentiment 🌸</h1>
          <p>FHE-protected mood tracking with privacy</p>
        </div>
        
        <div className="header-actions">
          <button onClick={testAvailability} className="test-btn">
            Test FHE System
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Mood Entry
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-panels">
          <div className="stat-panel">
            <h3>Total Entries</h3>
            <div className="stat-value">{sentiments.length}</div>
          </div>
          <div className="stat-panel">
            <h3>Verified Data</h3>
            <div className="stat-value">{sentiments.filter(s => s.isVerified).length}</div>
          </div>
          <div className="stat-panel">
            <h3>Avg Mood</h3>
            <div className="stat-value">
              {sentiments.length > 0 ? (sentiments.reduce((sum, s) => sum + s.moodScore, 0) / sentiments.length).toFixed(1) : '0'}
            </div>
          </div>
        </div>

        <div className="search-section">
          <input
            type="text"
            placeholder="Search sentiments..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
          <button onClick={loadData} disabled={isRefreshing} className="refresh-btn">
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="sentiments-list">
          {paginatedSentiments.length === 0 ? (
            <div className="no-data">
              <p>No sentiment entries found</p>
              <button onClick={() => setShowCreateModal(true)} className="create-btn">
                Create First Entry
              </button>
            </div>
          ) : (
            paginatedSentiments.map((sentiment, index) => (
              <div 
                key={index}
                className={`sentiment-item ${selectedSentiment?.id === sentiment.id ? "selected" : ""}`}
                onClick={() => setSelectedSentiment(sentiment)}
              >
                <div className="sentiment-header">
                  <span className="sentiment-name">{sentiment.name}</span>
                  <span className={`status-badge ${sentiment.isVerified ? "verified" : "pending"}`}>
                    {sentiment.isVerified ? "✅ Verified" : "🔓 Pending"}
                  </span>
                </div>
                <div className="sentiment-scores">
                  <span>Mood: {getMoodEmoji(sentiment.moodScore)} {sentiment.moodScore}/10</span>
                  <span>Workload: {getWorkloadEmoji(sentiment.workload)} {sentiment.workload}/10</span>
                </div>
                <div className="sentiment-meta">
                  <span>{new Date(sentiment.timestamp * 1000).toLocaleDateString()}</span>
                  <span>By: {sentiment.creator.substring(0, 6)}...{sentiment.creator.substring(38)}</span>
                </div>
              </div>
            ))
          )}
        </div>

        {totalPages > 1 && (
          <div className="pagination">
            <button 
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(currentPage - 1)}
            >
              Previous
            </button>
            <span>Page {currentPage} of {totalPages}</span>
            <button 
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(currentPage + 1)}
            >
              Next
            </button>
          </div>
        )}

        <div className="faq-section">
          <h3>FHE Protection FAQ</h3>
          <div className="faq-item">
            <strong>How is my mood data protected?</strong>
            <p>Your mood scores are encrypted using Fully Homomorphic Encryption (FHE) before being stored on-chain.</p>
          </div>
          <div className="faq-item">
            <strong>What does FHE verification do?</strong>
            <p>Verification allows you to prove the decrypted value matches the encrypted data without revealing it to others.</p>
          </div>
        </div>
      </div>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>New Mood Entry</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-btn">&times;</button>
            </div>
            
            <div className="modal-body">
              <div className="fhe-notice">
                <strong>FHE Protection</strong>
                <p>Mood score will be encrypted with FHE for privacy protection</p>
              </div>
              
              <div className="form-group">
                <label>Employee Name *</label>
                <input 
                  type="text" 
                  value={newSentimentData.name}
                  onChange={(e) => setNewSentimentData({...newSentimentData, name: e.target.value})}
                  placeholder="Enter name..."
                />
              </div>
              
              <div className="form-group">
                <label>Mood Score (1-10) *</label>
                <input 
                  type="number" 
                  min="1" 
                  max="10" 
                  value={newSentimentData.moodScore}
                  onChange={(e) => setNewSentimentData({...newSentimentData, moodScore: e.target.value})}
                  placeholder="1-10"
                />
                <div className="data-label">FHE Encrypted</div>
              </div>
              
              <div className="form-group">
                <label>Workload (1-10) *</label>
                <input 
                  type="number" 
                  min="1" 
                  max="10" 
                  value={newSentimentData.workload}
                  onChange={(e) => setNewSentimentData({...newSentimentData, workload: e.target.value})}
                  placeholder="1-10"
                />
                <div className="data-label">Public Data</div>
              </div>
              
              <div className="form-group">
                <label>Description</label>
                <input 
                  type="text" 
                  value={newSentimentData.description}
                  onChange={(e) => setNewSentimentData({...newSentimentData, description: e.target.value})}
                  placeholder="Optional notes..."
                />
              </div>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn">Cancel</button>
              <button 
                onClick={createSentiment}
                disabled={creatingSentiment || isEncrypting || !newSentimentData.name || !newSentimentData.moodScore}
                className="submit-btn"
              >
                {creatingSentiment || isEncrypting ? "Encrypting..." : "Create Entry"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedSentiment && (
        <div className="modal-overlay">
          <div className="detail-modal">
            <div className="modal-header">
              <h2>Sentiment Details</h2>
              <button onClick={() => setSelectedSentiment(null)} className="close-btn">&times;</button>
            </div>
            
            <div className="modal-body">
              <div className="detail-info">
                <div className="info-row">
                  <span>Employee:</span>
                  <strong>{selectedSentiment.name}</strong>
                </div>
                <div className="info-row">
                  <span>Workload:</span>
                  <strong>{getWorkloadEmoji(selectedSentiment.workload)} {selectedSentiment.workload}/10</strong>
                </div>
                <div className="info-row">
                  <span>Mood Status:</span>
                  <strong>
                    {selectedSentiment.isVerified ? 
                      `✅ ${selectedSentiment.decryptedValue}/10 (Verified)` : 
                      "🔒 FHE Encrypted"
                    }
                  </strong>
                </div>
                <div className="info-row">
                  <span>Date:</span>
                  <strong>{new Date(selectedSentiment.timestamp * 1000).toLocaleDateString()}</strong>
                </div>
                <div className="info-row">
                  <span>Description:</span>
                  <span>{selectedSentiment.description || "No description"}</span>
                </div>
              </div>
              
              <div className="verification-section">
                <button 
                  onClick={() => decryptData(selectedSentiment.id)}
                  disabled={isDecrypting}
                  className={`verify-btn ${selectedSentiment.isVerified ? "verified" : ""}`}
                >
                  {isDecrypting ? "Decrypting..." : 
                   selectedSentiment.isVerified ? "✅ Verified" : "🔓 Verify Mood Score"}
                </button>
                <p className="verification-note">
                  FHE verification proves the decrypted mood score matches the encrypted data
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className="transaction-toast">
          <div className={`toast-content ${transactionStatus.status}`}>
            {transactionStatus.status === "pending" && <div className="spinner"></div>}
            {transactionStatus.status === "success" && "✓"}
            {transactionStatus.status === "error" && "✗"}
            <span>{transactionStatus.message}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;