
import React, { useState, useEffect } from 'react'
import { render, Text, Box, useInput, useApp } from 'ink'
import Spinner from 'ink-spinner'
import fetch from 'node-fetch' // Need to ensure node-fetch is available or use native fetch in Node 18+
// Node 18 has global fetch, so we might not need import if environment is new enough. 
// workspace says Node 18+ usually. I'll blindly use global fetch or polyfill if needed.
// Actually `tsx` runs this, so it should be fine.

// Components
import ChannelList from './ChannelList'
import StatusDashboard from './StatusDashboard'

const App = () => {
    const [view, setView] = useState<'channels' | 'status'>('status')
    const { exit } = useApp()

    useInput((input, key) => {
        if (input === 'q') exit()
        if (input === '1') setView('status')
        if (input === '2') setView('channels')
    })

    return (
        <Box flexDirection="column" padding={1}>
            <Box borderStyle="round" borderColor="blue" paddingX={1}>
                <Text bold color="blue">EPG Manager TUI</Text>
                <Text> | </Text>
                <Text color={view === 'status' ? 'green' : 'white'}>[1] Status</Text>
                <Text> | </Text>
                <Text color={view === 'channels' ? 'green' : 'white'}>[2] Channels</Text>
                <Text> | </Text>
                <Text>[q] Quit</Text>
            </Box>

            <Box marginTop={1}>
                {view === 'status' && <StatusDashboard />}
                {view === 'channels' && <ChannelList />}
            </Box>
        </Box>
    )
}

render(<App />)
