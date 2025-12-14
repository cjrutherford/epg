
import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import Spinner from 'ink-spinner'

const StatusDashboard = () => {
    const [status, setStatus] = useState<any>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        const fetchStatus = async () => {
            try {
                const res = await fetch('http://localhost:3000/api/status')
                const data = await res.json()
                setStatus(data)
                setError(null)
            } catch (e) {
                setError('Could not connect to server (is it running?)')
            }
        }
        
        fetchStatus()
        const interval = setInterval(fetchStatus, 2000)
        return () => clearInterval(interval)
    }, [])

    if (error) {
        return (
            <Box flexDirection="column">
                <Text color="red">{error}</Text>
                <Text>Run 'npm run app:start' in another terminal.</Text>
            </Box>
        )
    }

    if (!status) return <Text><Spinner type="dots" /> Loading status...</Text>

    return (
        <Box flexDirection="column">
             <Text>Status: <Text color={status.running ? 'green' : 'white'}>{status.running ? 'Running' : 'Idle'}</Text></Text>
             <Text>Errors: <Text color={status.errorCount > 0 ? 'red' : 'green'}>{status.errorCount}</Text></Text>
             <Box marginTop={1}>
                {status.running && <Text color="yellow"><Spinner type="dots"/> Grabbing in progress...</Text>}
             </Box>
        </Box>
    )
}

export default StatusDashboard
