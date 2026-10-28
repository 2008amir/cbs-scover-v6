// One health monitor per live socket; inactivity alone is not a failure.
function createConnectionHealth({ now = Date.now, interval = setInterval, clear = clearInterval } = {}) {
    let current = null;
    return {
        attach(socket, reconnect) {
            this.dispose();
            const record = { socket, state: 'connecting', since: now(), recovering: false, timers: new Set() };
            current = record;
            const recover = () => {
                if (current !== record || record.recovering) return;
                record.recovering = true;
                reconnect();
            };
            socket.ev.on('connection.update', ({ connection }) => {
                if (current !== record || !connection) return;
                record.state = connection;
                record.since = now();
                if (connection === 'open') record.recovering = false;
            });
            record.timers.add(interval(() => {
                if (current !== record) return;
                if (record.state === 'open' && (socket.ws?.isClosed || socket.ws?.isClosing)) recover();
                if (record.state !== 'open' && now() - record.since >= 90000) recover();
            }, 30000));
        },
        interval(callback, delay) {
            const timer = interval(callback, delay);
            current?.timers.add(timer);
            return timer;
        },
        dispose() {
            const previous = current;
            current = null;
            if (!previous) return;
            for (const timer of previous.timers) clear(timer);
            previous.socket.ev.removeAllListeners?.();
            try { previous.socket.end?.(new Error('Replacing inactive WhatsApp connection')); } catch {}
        }
    };
}

module.exports = { createConnectionHealth };