import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface SentimentData {
  id: number;
  name: string;
  moodScore: string;
  team: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
  encryptedValueHandle?: string;
}

interface SentimentStats {
  averageMood: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  teamTrends: { [key: string]: number };
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
  const [newSentimentData, setNewSentimentData] = useState({ name: "", moodScore: "", team: "" });
  const [selectedSentiment, setSelectedSentiment] = useState<SentimentData | null>(null);
  const [decryptedData, setDecryptedData] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterTeam, setFilterTeam] = useState("all");
  const [userHistory, setUserHistory] = useState<string[]>([]);
  const [showStats, setShowStats] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        console.error('Failed to initialize FHEVM:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed." 
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
            id: parseInt(businessId.replace('sentiment-', '')) || Date.now(),
            name: businessData.name,
            moodScore: businessId,
            team: businessData.description,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
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
        0,
        0,
        newSentimentData.team
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setUserHistory(prev => [...prev, `Created sentiment: ${newSentimentData.name}`]);
      setTransactionStatus({ visible: true, status: "success", message: "Sentiment recorded successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewSentimentData({ name: "", moodScore: "", team: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
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
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified" });
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
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      setUserHistory(prev => [...prev, `Decrypted sentiment: ${clearValue}`]);
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const calculateStats = (): SentimentStats => {
    const verifiedSentiments = sentiments.filter(s => s.isVerified);
    const total = verifiedSentiments.length;
    
    if (total === 0) {
      return { averageMood: 0, positiveCount: 0, neutralCount: 0, negativeCount: 0, teamTrends: {} };
    }

    const sum = verifiedSentiments.reduce((acc, s) => acc + (s.decryptedValue || 0), 0);
    const averageMood = sum / total;
    
    const positiveCount = verifiedSentiments.filter(s => (s.decryptedValue || 0) >= 7).length;
    const neutralCount = verifiedSentiments.filter(s => (s.decryptedValue || 0) >= 4 && (s.decryptedValue || 0) < 7).length;
    const negativeCount = verifiedSentiments.filter(s => (s.decryptedValue || 0) < 4).length;

    const teamTrends: { [key: string]: number } = {};
    verifiedSentiments.forEach(s => {
      if (s.team && s.team !== "undefined") {
        if (!teamTrends[s.team]) teamTrends[s.team] = 0;
        teamTrends[s.team] += s.decryptedValue || 0;
      }
    });

    Object.keys(teamTrends).forEach(team => {
      const teamCount = verifiedSentiments.filter(s => s.team === team).length;
      teamTrends[team] = teamTrends[team] / teamCount;
    });

    return { averageMood, positiveCount, neutralCount, negativeCount, teamTrends };
  };

  const filteredSentiments = sentiments.filter(sentiment => {
    const matchesSearch = sentiment.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         sentiment.team.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesTeam = filterTeam === "all" || sentiment.team === filterTeam;
    return matchesSearch && matchesTeam;
  });

  const teams = Array.from(new Set(sentiments.map(s => s.team).filter(Boolean)));

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🔐 Confidential Sentiment</h1>
            <p>FHE Encrypted Employee Feedback</p>
          </div>
          <ConnectButton />
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔒</div>
            <h2>Connect Your Wallet</h2>
            <p>Securely share your sentiment with FHE encryption</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted sentiment system...</p>
    </div>
  );

  const stats = calculateStats();

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-section">
          <h1>😊 Confidential Sentiment</h1>
          <p>FHE Protected Employee Feedback</p>
        </div>
        
        <div className="header-actions">
          <button className="neon-btn" onClick={checkAvailability}>
            Check Availability
          </button>
          <button className="neon-btn primary" onClick={() => setShowCreateModal(true)}>
            + Share Sentiment
          </button>
          <ConnectButton />
        </div>
      </header>

      <div className="main-layout">
        <aside className="sidebar">
          <div className="stats-panel">
            <h3>Team Morale</h3>
            <div className="stat-item">
              <span>Average Mood</span>
              <div className="stat-value">{stats.averageMood.toFixed(1)}/10</div>
            </div>
            <div className="stat-item">
              <span>Positive</span>
              <div className="stat-value positive">{stats.positiveCount}</div>
            </div>
            <div className="stat-item">
              <span>Neutral</span>
              <div className="stat-value neutral">{stats.neutralCount}</div>
            </div>
            <div className="stat-item">
              <span>Negative</span>
              <div className="stat-value negative">{stats.negativeCount}</div>
            </div>
          </div>

          <div className="fhe-info-panel">
            <h4>FHE Encryption Flow</h4>
            <div className="flow-step">
              <span>1</span>
              <p>Encrypt sentiment locally</p>
            </div>
            <div className="flow-step">
              <span>2</span>
              <p>Store encrypted on-chain</p>
            </div>
            <div className="flow-step">
              <span>3</span>
              <p>Compute statistics privately</p>
            </div>
          </div>

          <div className="user-history">
            <h4>Your Activity</h4>
            {userHistory.slice(-5).map((item, index) => (
              <div key={index} className="history-item">{item}</div>
            ))}
          </div>
        </aside>

        <main className="content-area">
          <div className="controls-bar">
            <div className="search-filter">
              <input
                type="text"
                placeholder="Search sentiments..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
              />
              <select 
                value={filterTeam} 
                onChange={(e) => setFilterTeam(e.target.value)}
                className="filter-select"
              >
                <option value="all">All Teams</option>
                {teams.map(team => (
                  <option key={team} value={team}>{team}</option>
                ))}
              </select>
            </div>
            
            <div className="view-controls">
              <button 
                className={`view-btn ${!showStats ? 'active' : ''}`}
                onClick={() => setShowStats(false)}
              >
                List View
              </button>
              <button 
                className={`view-btn ${showStats ? 'active' : ''}`}
                onClick={() => setShowStats(true)}
              >
                Statistics
              </button>
              <button onClick={loadData} className="refresh-btn">
                🔄
              </button>
            </div>
          </div>

          {showStats ? (
            <div className="stats-view">
              <div className="chart-container">
                <h3>Mood Distribution</h3>
                <div className="chart-bars">
                  <div className="chart-bar positive" style={{ height: `${(stats.positiveCount / sentiments.length) * 100}%` }}>
                    <span>Positive</span>
                  </div>
                  <div className="chart-bar neutral" style={{ height: `${(stats.neutralCount / sentiments.length) * 100}%` }}>
                    <span>Neutral</span>
                  </div>
                  <div className="chart-bar negative" style={{ height: `${(stats.negativeCount / sentiments.length) * 100}%` }}>
                    <span>Negative</span>
                  </div>
                </div>
              </div>

              <div className="team-stats">
                <h3>Team Averages</h3>
                {Object.entries(stats.teamTrends).map(([team, avg]) => (
                  <div key={team} className="team-stat">
                    <span>{team}</span>
                    <div className="team-score">{avg.toFixed(1)}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="sentiments-grid">
              {filteredSentiments.length === 0 ? (
                <div className="empty-state">
                  <p>No sentiments found</p>
                  <button onClick={() => setShowCreateModal(true)} className="neon-btn">
                    Share First Sentiment
                  </button>
                </div>
              ) : (
                filteredSentiments.map((sentiment, index) => (
                  <div 
                    key={index} 
                    className="sentiment-card"
                    onClick={() => setSelectedSentiment(sentiment)}
                  >
                    <div className="card-header">
                      <h3>{sentiment.name}</h3>
                      <span className={`status ${sentiment.isVerified ? 'verified' : 'encrypted'}`}>
                        {sentiment.isVerified ? '✅ Verified' : '🔒 Encrypted'}
                      </span>
                    </div>
                    <div className="card-content">
                      <p>Team: {sentiment.team}</p>
                      <p>Date: {new Date(sentiment.timestamp * 1000).toLocaleDateString()}</p>
                      {sentiment.isVerified && (
                        <div className="mood-display">
                          Mood: {sentiment.decryptedValue}/10
                        </div>
                      )}
                    </div>
                    <div className="card-footer">
                      <span className="creator">By: {sentiment.creator.substring(0, 8)}...</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </main>
      </div>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Share Your Sentiment</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-btn">×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Your Name</label>
                <input
                  type="text"
                  value={newSentimentData.name}
                  onChange={(e) => setNewSentimentData({...newSentimentData, name: e.target.value})}
                  placeholder="Enter your name"
                />
              </div>
              <div className="form-group">
                <label>Mood Score (1-10)</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={newSentimentData.moodScore}
                  onChange={(e) => setNewSentimentData({...newSentimentData, moodScore: e.target.value})}
                  placeholder="1-10"
                />
                <small>FHE Encrypted Integer</small>
              </div>
              <div className="form-group">
                <label>Team</label>
                <input
                  type="text"
                  value={newSentimentData.team}
                  onChange={(e) => setNewSentimentData({...newSentimentData, team: e.target.value})}
                  placeholder="Your team name"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="btn secondary">Cancel</button>
              <button 
                onClick={createSentiment} 
                disabled={creatingSentiment || isEncrypting}
                className="btn primary"
              >
                {creatingSentiment ? 'Encrypting...' : 'Share Sentiment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedSentiment && (
        <div className="modal-overlay">
          <div className="modal-content large">
            <div className="modal-header">
              <h2>Sentiment Details</h2>
              <button onClick={() => {
                setSelectedSentiment(null);
                setDecryptedData(null);
              }} className="close-btn">×</button>
            </div>
            <div className="modal-body">
              <div className="detail-grid">
                <div className="detail-item">
                  <label>Employee</label>
                  <span>{selectedSentiment.name}</span>
                </div>
                <div className="detail-item">
                  <label>Team</label>
                  <span>{selectedSentiment.team}</span>
                </div>
                <div className="detail-item">
                  <label>Date</label>
                  <span>{new Date(selectedSentiment.timestamp * 1000).toLocaleString()}</span>
                </div>
                <div className="detail-item">
                  <label>Status</label>
                  <span className={selectedSentiment.isVerified ? 'verified' : 'encrypted'}>
                    {selectedSentiment.isVerified ? 'Decrypted & Verified' : 'FHE Encrypted'}
                  </span>
                </div>
                <div className="detail-item full">
                  <label>Mood Value</label>
                  <div className="mood-value">
                    {selectedSentiment.isVerified ? (
                      <span className="decrypted-value">{selectedSentiment.decryptedValue}/10</span>
                    ) : decryptedData !== null ? (
                      <span className="decrypted-value">{decryptedData}/10</span>
                    ) : (
                      <span className="encrypted-value">🔒 Encrypted (FHE Protected)</span>
                    )}
                  </div>
                </div>
              </div>

              {!selectedSentiment.isVerified && (
                <div className="decryption-section">
                  <button 
                    onClick={async () => {
                      const result = await decryptData(selectedSentiment.moodScore);
                      if (result !== null) setDecryptedData(result);
                    }}
                    disabled={isDecrypting}
                    className="btn primary"
                  >
                    {isDecrypting ? 'Decrypting...' : 'Decrypt Mood'}
                  </button>
                  <p className="fhe-note">
                    FHE decryption happens locally. The proof is then verified on-chain.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className={`toast ${transactionStatus.status}`}>
          {transactionStatus.message}
        </div>
      )}
    </div>
  );
};

export default App;


