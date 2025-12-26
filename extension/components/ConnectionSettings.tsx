/**
 * Connection Settings UI Component
 * Allows users to configure backend URL and auth token
 */

import React, { useState, useEffect } from 'react'
import {
  getConnectionSettings,
  saveConnectionSettings,
  testConnection
} from '../lib/connection'

type TestStatus = 'idle' | 'testing' | 'success' | 'error'

interface ConnectionSettingsProps {
  onClose?: () => void
}

export function ConnectionSettingsPanel({ onClose }: ConnectionSettingsProps) {
  const [backendUrl, setBackendUrl] = useState('')
  const [authToken, setAuthToken] = useState('')
  const [originalUrl, setOriginalUrl] = useState('')
  const [originalToken, setOriginalToken] = useState('')
  const [testStatus, setTestStatus] = useState<TestStatus>('idle')
  const [testError, setTestError] = useState('')
  const [testLatency, setTestLatency] = useState<number | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')

  // Compute isDirty by comparing current values to original
  const isDirty = backendUrl !== originalUrl || authToken !== originalToken

  // Load current settings on mount
  useEffect(() => {
    async function loadSettings() {
      const settings = await getConnectionSettings()
      setBackendUrl(settings.apiUrl)
      setAuthToken(settings.authToken)
      setOriginalUrl(settings.apiUrl)
      setOriginalToken(settings.authToken)
    }
    loadSettings()
  }, [])

  // Track changes
  const handleUrlChange = (value: string) => {
    setBackendUrl(value)
    setTestStatus('idle')
  }

  const handleTokenChange = (value: string) => {
    setAuthToken(value)
    setTestStatus('idle')
  }

  // Test connection
  const handleTest = async () => {
    setTestStatus('testing')
    setTestError('')
    setTestLatency(null)

    const result = await testConnection(backendUrl, authToken || undefined)

    if (result.success) {
      setTestStatus('success')
      setTestLatency(result.latencyMs ?? null)
    } else {
      setTestStatus('error')
      setTestError(result.error || 'Connection failed')
    }
  }

  // Save settings
  const handleSave = async () => {
    setSaveStatus('saving')

    try {
      await saveConnectionSettings({
        backendUrl,
        authToken
      })
      // Update original values to match saved values
      setOriginalUrl(backendUrl)
      setOriginalToken(authToken)
      setSaveStatus('saved')

      // Reset save status after delay
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch (err) {
      console.error('Failed to save settings:', err)
      setSaveStatus('idle')
    }
  }

  return (
    <div className="p-4 space-y-6 bg-gray-900 text-white">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Connection Settings</h2>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        )}
      </div>

      {/* Backend URL */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-300">
          Backend URL
        </label>
        <input
          type="text"
          value={backendUrl}
          onChange={(e) => handleUrlChange(e.target.value)}
          placeholder="http://localhost:8129 or https://8129--xxx.gitpod.dev"
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md 
                     text-white placeholder-gray-500 focus:outline-none focus:ring-2 
                     focus:ring-blue-500 focus:border-transparent"
        />
        <p className="text-xs text-gray-500">
          For Ona environments, run{' '}
          <code className="bg-gray-800 px-1 rounded">
            gitpod environment port open 8129
          </code>{' '}
          and use the returned URL.
        </p>
      </div>

      {/* Auth Token */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-300">
          Auth Token
        </label>
        <input
          type="password"
          value={authToken}
          onChange={(e) => handleTokenChange(e.target.value)}
          placeholder="Optional for localhost"
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md 
                     text-white placeholder-gray-500 focus:outline-none focus:ring-2 
                     focus:ring-blue-500 focus:border-transparent"
        />
        <p className="text-xs text-gray-500">
          Set <code className="bg-gray-800 px-1 rounded">OKO_AUTH_TOKEN</code>{' '}
          environment variable in your Ona environment, then enter the same value here.
        </p>
      </div>

      {/* Test Connection */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <button
            onClick={handleTest}
            disabled={testStatus === 'testing'}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 
                       disabled:cursor-not-allowed rounded-md text-sm font-medium 
                       transition-colors"
          >
            {testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
          </button>

          {testStatus === 'success' && (
            <span className="text-green-400 text-sm flex items-center gap-1">
              ✓ Connected
              {testLatency !== null && (
                <span className="text-gray-400">({testLatency}ms)</span>
              )}
            </span>
          )}

          {testStatus === 'error' && (
            <span className="text-red-400 text-sm">✗ {testError}</span>
          )}
        </div>
      </div>

      {/* Save Button */}
      <div className="pt-4 border-t border-gray-700">
        <button
          onClick={handleSave}
          disabled={!isDirty || saveStatus === 'saving'}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors
            ${isDirty
              ? 'bg-green-600 hover:bg-green-700 text-white'
              : 'bg-gray-700 text-gray-400 cursor-not-allowed'
            }
            ${saveStatus === 'saving' ? 'opacity-50 cursor-wait' : ''}
          `}
        >
          {saveStatus === 'saving'
            ? 'Saving...'
            : saveStatus === 'saved'
            ? '✓ Saved'
            : 'Save Settings'}
        </button>

        {!isDirty && saveStatus === 'idle' && (
          <span className="ml-3 text-sm text-gray-500">No changes</span>
        )}
      </div>

      {/* Help Section */}
      <div className="pt-4 border-t border-gray-700">
        <details className="text-sm">
          <summary className="cursor-pointer text-gray-400 hover:text-white">
            Setup Instructions
          </summary>
          <div className="mt-2 space-y-2 text-gray-400">
            <p>
              <strong>Local development:</strong> Leave defaults (localhost:8129).
              Start the backend with <code>npm start</code>.
            </p>
            <p>
              <strong>Ona environment:</strong>
            </p>
            <ol className="list-decimal list-inside ml-2 space-y-1">
              <li>
                Set <code>OKO_AUTH_TOKEN</code> in your environment
              </li>
              <li>
                Run <code>gitpod environment port open 8129</code>
              </li>
              <li>Copy the returned URL here</li>
              <li>Enter the same auth token value</li>
              <li>Click Test Connection to verify</li>
            </ol>
          </div>
        </details>
      </div>
    </div>
  )
}

export default ConnectionSettingsPanel
