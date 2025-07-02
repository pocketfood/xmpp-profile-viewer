const { client, xml } = require('@xmpp/client');
const debug = require('@xmpp/debug');

document.addEventListener('DOMContentLoaded', function () {
    const loginForm = document.getElementById('loginForm');

    if (loginForm) {
        // Prefill values from localStorage if available
        document.getElementById('server').value = localStorage.getItem('server') || '';
        document.getElementById('resource').value = localStorage.getItem('resource') || '';

        loginForm.addEventListener('submit', async function (event) {
            event.preventDefault();

            const jid = document.getElementById('jid').value;
            const password = document.getElementById('password').value;
            const server = document.getElementById('server').value;
            const resource = document.getElementById('resource').value || 'xmpp-client';

            document.getElementById('error-message').textContent = '';

            try {
                const xmpp = client({
                    service: server,
                    domain: jid.split('@')[1],
                    resource: resource,
                    username: jid.split('@')[0],
                    password: password,
                });

                debug(xmpp, true);
                window._xmpp = xmpp;

                xmpp.on('error', (err) => {
                    console.error('❌ Error:', err.toString());
                    document.getElementById('error-message').textContent = 'Login failed. Please try again.';
                });

                xmpp.on('offline', () => {
                    console.log('🛑 Offline');
                });

                xmpp.on('stanza', handleStanza);

                xmpp.on('online', async (address) => {
                    console.log('🗸 Online as', address.toString());

                    // Save values to localStorage
                    localStorage.setItem('jid', jid);
                    localStorage.setItem('server', server);
                    localStorage.setItem('resource', resource);
                    localStorage.setItem('password', password);

                    // Request vCard
                    const vCardRequest = xml(
                        'iq',
                        { type: 'get', id: 'vCardFetch' },
                        xml('vCard', { xmlns: 'vcard-temp' })
                    );
                    xmpp.send(vCardRequest);

                    // Request roster
                    getRoster(xmpp);

                    // Send presence
                    xmpp.send(xml('presence'));
                });

                await xmpp.start();

                if (window.location.pathname.endsWith('profile.html')) {
                    handleProfile();
                }

            } catch (error) {
                console.error('❌ Error:', error);
                document.getElementById('error-message').textContent = 'Login failed. Please try again.';
            }
        });
    }

    // Profile page logic
    if (window.location.pathname.endsWith('profile.html')) {
        const jid = localStorage.getItem('jid');
        const avatar = localStorage.getItem('avatar');
        const roster = JSON.parse(localStorage.getItem('roster') || '[]');

        if (!jid) {
            window.location.href = 'index.html';
        } else {
            const userInfoDiv = document.getElementById('user-info');
            userInfoDiv.innerHTML = `
                ${avatar ? `<img src="data:image/jpeg;base64,${avatar}" alt="Avatar" class="avatar">` : ''}
                <p>${jid}</p>
            `;
            displayRoster(roster);
        }

        // Reconnect using saved values
        const server = localStorage.getItem('server');
        const resource = localStorage.getItem('resource') || 'xmpp-client';
        const password = localStorage.getItem('password');

        if (jid && server && password) {
            const xmpp = client({
                service: server,
                domain: jid.split('@')[1],
                resource: resource,
                username: jid.split('@')[0],
                password: password,
            });

            debug(xmpp, true);
            window._xmpp = xmpp;

            xmpp.on('error', (err) => console.error('[RECONNECT] ❌', err.toString()));
            xmpp.on('stanza', handleStanza);
            xmpp.on('online', () => console.log('[RECONNECT] ✅ Online'));

            xmpp.start().catch(console.error);
        }
    }
});

function handleStanza(stanza) {
    console.log('📩 Received stanza:', stanza.toString());

    // vCard
    if (stanza.is('iq') && stanza.attrs.id === 'vCardFetch' && stanza.attrs.type === 'result') {
        const vCard = stanza.getChild('vCard');
        if (vCard) {
            const photoElem = vCard.getChild('PHOTO');
            if (photoElem) {
                const dataElem = photoElem.getChild('BINVAL');
                if (dataElem) {
                    const avatar = dataElem.getText();
                    localStorage.setItem('avatar', avatar);
                }
            }
            window.location.href = 'profile.html';
        }
    }

    // Roster
    if (stanza.is('iq') && stanza.attrs.id === 'rosterFetch' && stanza.attrs.type === 'result') {
        const query = stanza.getChild('query', 'jabber:iq:roster');
        const items = query.getChildren('item');
        const roster = items.map((item) => ({
            jid: item.attrs.jid,
            name: item.attrs.name || item.attrs.jid,
        }));
        localStorage.setItem('roster', JSON.stringify(roster));
        displayRoster(roster);
    }

    // Presence
    if (stanza.is('presence') && stanza.attrs.from) {
        const fromJID = stanza.attrs.from.split('/')[0];
        const type = stanza.attrs.type || 'available';

        let status = 'online';
        if (type === 'unavailable') status = 'offline';

        const show = stanza.getChildText('show');
        if (show === 'away') status = 'away';
        else if (show === 'dnd') status = 'dnd';

        updatePresence(fromJID, status);
    }

    // Service Discovery
    if (stanza.is('iq') && stanza.attrs.id === 'disco-info' && stanza.attrs.type === 'result') {
        const query = stanza.getChild('query', 'http://jabber.org/protocol/disco#info');
        if (!query) return;

        const identities = query.getChildren('identity');
        const features = query.getChildren('feature');

        const resultsDiv = document.getElementById('disco-results');
        if (!resultsDiv) return;

        resultsDiv.innerHTML = `
            <h4>Identities</h4>
            <ul>${identities.map(id =>
                `<li>${id.attrs.category}/${id.attrs.type} — ${id.attrs.name || ''}</li>`
            ).join('')}</ul>
            <h4>Features</h4>
            <ul>${features.map(f =>
                `<li>${f.attrs.var}</li>`
            ).join('')}</ul>
        `;
    }
}

// Roster request
function getRoster(xmpp) {
    const rosterRequest = xml(
        'iq',
        { type: 'get', id: 'rosterFetch' },
        xml('query', { xmlns: 'jabber:iq:roster' })
    );
    xmpp.send(rosterRequest);
}

// Display roster
function displayRoster(roster) {
    const container = document.querySelector('.roster-container');
    container.innerHTML = `
        <h3>Roster</h3>
        <ul>
            ${roster.map(contact => `
                <li data-jid="${contact.jid}">
                    <span class="presence-bubble offline" title="offline"></span>
                    ${contact.name} (${contact.jid})
                </li>
            `).join('')}
        </ul>
    `;
}

// Update presence indicator
function updatePresence(jid, status) {
    const el = document.querySelector(`li[data-jid="${jid}"] .presence-bubble`);
    if (el) {
        el.className = `presence-bubble ${status}`;
        el.title = status;
    }
}

// Log out
window.logOut = function () {
    localStorage.clear();
    window.location.href = 'index.html';
};

// Discover server features
window.discoverServices = function () {
    const jid = localStorage.getItem('jid');
    if (!jid || !window._xmpp) return;

    const domain = jid.split('@')[1];
    const discoIQ = xml(
        'iq',
        { type: 'get', to: domain, id: 'disco-info' },
        xml('query', { xmlns: 'http://jabber.org/protocol/disco#info' })
    );

    console.log('🔍 Sending disco#info to domain:', domain);
    window._xmpp.send(discoIQ);
};
