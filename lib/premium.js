/* Premium check — fully local.
   The old remote access host (accesses-1.zone.id) is dead and every request
   to it failed, so premium status is now decided from the local owner list. */
const fs = require('fs');
const path = require('path');

function digits(v) {
    return String(v || '').split('@')[0].split(':')[0].replace(/\D/g, '');
}

function owners() {
    const list = [String(global.ownernumber || '')];
    for (const file of [
        path.join(__dirname, '..', 'database', 'owner.json'),
        path.join(__dirname, 'database', 'owner.json')
    ]) {
        try {
            const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (Array.isArray(parsed)) list.push(...parsed.map(String));
        } catch {}
    }
    return list.map(digits).filter(Boolean);
}

async function checkPremiumUser(userId) {
    const num = digits(userId);
    if (!num) return false;
    return owners().includes(num);
}

module.exports = { checkPremiumUser };
