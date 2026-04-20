import React, { useState, useEffect } from 'react';

export default function SyncSupabaseModal({ open, onClose, onSync }) {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    setResult(null);

    try {
      const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';
      console.log('🔄 Starting sync...');

      const res = await fetch(`${API_URL}/api/products/sync-supabase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!res.ok) throw new Error('Sync failed');

      const data = await res.json();
      console.log('✅ Sync completed:', data);
      setResult(data);
      setSyncing(false);

      // Auto-close after 3 seconds if successful
      setTimeout(() => {
        onSync?.();
      }, 2000);
    } catch (err) {
      console.error('❌ Sync error:', err);
      setError(err.message);
      setSyncing(false);
    }
  };

  if (!open) return null;

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        {/* Header */}
        <div style={styles.header}>
          <h2 style={styles.title}>Sync from Supabase</h2>
          <button
            onClick={onClose}
            style={styles.closeBtn}
            disabled={syncing}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div style={styles.content}>
          {!syncing && !result && !error && (
            <div style={styles.initial}>
              <i className="fa-solid fa-database" style={styles.largeIcon} />
              <p style={styles.description}>
                This will pull products from Supabase and merge them with your existing products.
              </p>
              <ul style={styles.infoList}>
                <li>✅ New products will be added</li>
                <li>🔄 Existing products will be updated</li>
                <li>📌 GitHub CMS products will be protected</li>
              </ul>
            </div>
          )}

          {syncing && (
            <div style={styles.syncing}>
              <i className="fa-solid fa-spinner" style={styles.spinner} />
              <p style={styles.syncingText}>Syncing products from Supabase...</p>
              <div style={styles.progressBar}>
                <div style={styles.progressFill} />
              </div>
            </div>
          )}

          {result && (
            <div style={styles.results}>
              <div style={styles.successBanner}>
                <i className="fa-solid fa-check-circle" />
                <span>Sync completed successfully!</span>
              </div>

              <div style={styles.statsGrid}>
                <div style={styles.statBox}>
                  <div style={styles.statNumber}>{result.scanned || 0}</div>
                  <div style={styles.statLabel}>Products Scanned</div>
                </div>
                <div style={styles.statBox}>
                  <div style={styles.statNumber}>{result.added || 0}</div>
                  <div style={styles.statLabel}>Added</div>
                </div>
                <div style={styles.statBox}>
                  <div style={styles.statNumber}>{result.updated || 0}</div>
                  <div style={styles.statLabel}>Updated</div>
                </div>
                <div style={styles.statBox}>
                  <div style={styles.statNumber}>{result.kept || 0}</div>
                  <div style={styles.statLabel}>Protected</div>
                </div>
              </div>

              {result.added_products && result.added_products.length > 0 && (
                <div style={styles.section}>
                  <h3 style={styles.sectionTitle}>
                    <i className="fa-solid fa-plus" /> Added Products
                  </h3>
                  <div style={styles.productsList}>
                    {result.added_products.map((p, i) => (
                      <div key={i} style={styles.productItem}>
                        <div style={styles.productIcon}>✨</div>
                        <div style={styles.productInfo}>
                          <div style={styles.productName}>{p.name}</div>
                          <div style={styles.productSlug}>{p.slug}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.updated_products && result.updated_products.length > 0 && (
                <div style={styles.section}>
                  <h3 style={styles.sectionTitle}>
                    <i className="fa-solid fa-refresh" /> Updated Products
                  </h3>
                  <div style={styles.productsList}>
                    {result.updated_products.map((p, i) => (
                      <div key={i} style={styles.productItem}>
                        <div style={styles.productIcon}>🔄</div>
                        <div style={styles.productInfo}>
                          <div style={styles.productName}>{p.name}</div>
                          <div style={styles.productSlug}>{p.slug}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.kept_products && result.kept_products.length > 0 && (
                <div style={styles.section}>
                  <h3 style={styles.sectionTitle}>
                    <i className="fa-solid fa-shield" /> Protected Products (GitHub CMS)
                  </h3>
                  <div style={styles.productsList}>
                    {result.kept_products.map((p, i) => (
                      <div key={i} style={styles.productItem}>
                        <div style={styles.productIcon}>📌</div>
                        <div style={styles.productInfo}>
                          <div style={styles.productName}>{p.name}</div>
                          <div style={styles.productSlug}>{p.slug}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {error && (
            <div style={styles.errorBanner}>
              <i className="fa-solid fa-exclamation-circle" />
              <div>
                <div style={styles.errorTitle}>Sync Failed</div>
                <div style={styles.errorMessage}>{error}</div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          {!syncing && !result && (
            <>
              <button onClick={onClose} style={styles.btnCancel}>
                Cancel
              </button>
              <button onClick={handleSync} style={styles.btnSync}>
                <i className="fa-solid fa-sync" /> Start Sync
              </button>
            </>
          )}
          {syncing && <div style={styles.syncingFooter}>Please wait...</div>}
          {(result || error) && (
            <button
              onClick={() => {
                setResult(null);
                setError(null);
                onClose();
              }}
              style={styles.btnClose}
            >
              Close
            </button>
          )}
        </div>

        <style>{`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          @keyframes slideUp {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
        `}</style>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000
  },
  modal: {
    backgroundColor: '#fff',
    borderRadius: '8px',
    boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
    maxWidth: '600px',
    width: '90%',
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    animation: 'slideUp 0.3s ease-out'
  },
  header: {
    padding: '20px 24px',
    borderBottom: '1px solid #e0e0e0',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  title: {
    margin: 0,
    fontSize: '1.3rem',
    fontWeight: '600',
    color: '#333'
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    fontSize: '1.5rem',
    cursor: 'pointer',
    color: '#999',
    padding: '0',
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '4px',
    transition: 'all 0.2s'
  },
  content: {
    flex: 1,
    overflow: 'auto',
    padding: '24px'
  },
  initial: {
    textAlign: 'center',
    py: 3
  },
  largeIcon: {
    fontSize: '3rem',
    color: 'var(--brand, #007bff)',
    marginBottom: '16px'
  },
  description: {
    color: '#666',
    fontSize: '0.95rem',
    marginBottom: '20px',
    lineHeight: '1.5'
  },
  infoList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    textAlign: 'left',
    display: 'inline-block'
  },
  syncing: {
    textAlign: 'center',
    padding: '40px 20px'
  },
  spinner: {
    fontSize: '3rem',
    color: 'var(--brand, #007bff)',
    animation: 'spin 1s linear infinite',
    marginBottom: '16px'
  },
  syncingText: {
    color: '#666',
    marginBottom: '20px',
    fontSize: '1rem'
  },
  progressBar: {
    width: '100%',
    height: '4px',
    backgroundColor: '#e0e0e0',
    borderRadius: '2px',
    overflow: 'hidden',
    marginTop: '20px'
  },
  progressFill: {
    height: '100%',
    backgroundColor: 'var(--brand, #007bff)',
    animation: 'pulse 1.5s ease-in-out infinite',
    width: '30%'
  },
  results: {
    animation: 'slideUp 0.3s ease-out'
  },
  successBanner: {
    backgroundColor: '#d4edda',
    color: '#155724',
    padding: '12px 16px',
    borderRadius: '4px',
    marginBottom: '20px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '0.95rem'
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '12px',
    marginBottom: '24px'
  },
  statBox: {
    backgroundColor: '#f5f5f5',
    padding: '16px',
    borderRadius: '6px',
    textAlign: 'center',
    border: '1px solid #e0e0e0'
  },
  statNumber: {
    fontSize: '1.8rem',
    fontWeight: '700',
    color: 'var(--brand, #007bff)',
    marginBottom: '6px'
  },
  statLabel: {
    fontSize: '0.75rem',
    color: '#999',
    textTransform: 'uppercase',
    fontWeight: '500'
  },
  section: {
    marginBottom: '24px'
  },
  sectionTitle: {
    fontSize: '0.95rem',
    fontWeight: '600',
    color: '#333',
    marginBottom: '12px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  productsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    maxHeight: '200px',
    overflow: 'auto'
  },
  productItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px',
    backgroundColor: '#f9f9f9',
    borderRadius: '4px',
    border: '1px solid #f0f0f0'
  },
  productIcon: {
    fontSize: '1.2rem',
    width: '24px',
    textAlign: 'center'
  },
  productInfo: {
    flex: 1,
    minWidth: 0
  },
  productName: {
    fontWeight: '500',
    color: '#333',
    fontSize: '0.9rem',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  productSlug: {
    fontSize: '0.8rem',
    color: '#999'
  },
  errorBanner: {
    backgroundColor: '#f8d7da',
    color: '#721c24',
    padding: '16px',
    borderRadius: '4px',
    border: '1px solid #f5c6cb',
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  errorTitle: {
    fontWeight: '600',
    marginBottom: '4px'
  },
  errorMessage: {
    fontSize: '0.9rem'
  },
  footer: {
    padding: '16px 24px',
    borderTop: '1px solid #e0e0e0',
    display: 'flex',
    gap: '12px',
    justifyContent: 'flex-end'
  },
  btnCancel: {
    padding: '8px 16px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    backgroundColor: '#fff',
    cursor: 'pointer',
    fontSize: '0.9rem',
    transition: 'all 0.2s'
  },
  btnSync: {
    padding: '8px 16px',
    border: 'none',
    borderRadius: '4px',
    backgroundColor: 'var(--brand, #007bff)',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '0.9rem',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    transition: 'all 0.2s'
  },
  btnClose: {
    padding: '8px 16px',
    border: 'none',
    borderRadius: '4px',
    backgroundColor: 'var(--brand, #007bff)',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '0.9rem',
    transition: 'all 0.2s'
  },
  syncingFooter: {
    color: '#666',
    fontSize: '0.9rem'
  }
};
