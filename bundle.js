(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
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

},{"@xmpp/client":5,"@xmpp/debug":10}],2:[function(require,module,exports){
(function (global){(function (){
"use strict";

module.exports.encode = function encode(string) {
  return global.btoa(string);
};

module.exports.decode = function decode(string) {
  return global.atob(string);
};

}).call(this)}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],3:[function(require,module,exports){
"use strict";

const Client = require("./lib/Client");
const xml = require("@xmpp/xml");
const jid = require("@xmpp/jid");

module.exports.Client = Client;
module.exports.xml = xml;
module.exports.jid = jid;

},{"./lib/Client":4,"@xmpp/jid":21,"@xmpp/xml":48}],4:[function(require,module,exports){
"use strict";

const Connection = require("@xmpp/connection");

class Client extends Connection {
  constructor(options) {
    super(options);
    this.transports = [];
  }

  send(element, ...args) {
    return this.Transport.prototype.send.call(this, element, ...args);
  }

  sendMany(...args) {
    return this.Transport.prototype.sendMany.call(this, ...args);
  }

  _findTransport(service) {
    return this.transports.find((Transport) => {
      try {
        return Transport.prototype.socketParameters(service) !== undefined;
      } catch {
        return false;
      }
    });
  }

  connect(service) {
    const Transport = this._findTransport(service);

    if (!Transport) {
      throw new Error("No compatible connection method found.");
    }

    this.Transport = Transport;
    this.Socket = Transport.prototype.Socket;
    this.Parser = Transport.prototype.Parser;

    return super.connect(service);
  }

  socketParameters(...args) {
    return this.Transport.prototype.socketParameters(...args);
  }

  header(...args) {
    return this.Transport.prototype.header(...args);
  }

  headerElement(...args) {
    return this.Transport.prototype.headerElement(...args);
  }

  footer(...args) {
    return this.Transport.prototype.footer(...args);
  }

  footerElement(...args) {
    return this.Transport.prototype.footerElement(...args);
  }
}

Client.prototype.NS = "jabber:client";

module.exports = Client;

},{"@xmpp/connection":7}],5:[function(require,module,exports){
"use strict";

const { xml, jid, Client } = require("@xmpp/client-core");
const getDomain = require("./lib/getDomain");

const _reconnect = require("@xmpp/reconnect");
const _websocket = require("@xmpp/websocket");
const _middleware = require("@xmpp/middleware");
const _streamFeatures = require("@xmpp/stream-features");
const _iqCaller = require("@xmpp/iq/caller");
const _iqCallee = require("@xmpp/iq/callee");
const _resolve = require("@xmpp/resolve");

// Stream features - order matters and define priority
const _sasl = require("@xmpp/sasl");
const _resourceBinding = require("@xmpp/resource-binding");
const _sessionEstablishment = require("@xmpp/session-establishment");
const _streamManagement = require("@xmpp/stream-management");

// SASL mechanisms - order matters and define priority
const anonymous = require("@xmpp/sasl-anonymous");
const plain = require("@xmpp/sasl-plain");

function client(options = {}) {
  const { resource, credentials, username, password, ...params } = options;

  const { domain, service } = params;
  if (!domain && service) {
    params.domain = getDomain(service);
  }

  const entity = new Client(params);

  const reconnect = _reconnect({ entity });
  const websocket = _websocket({ entity });

  const middleware = _middleware({ entity });
  const streamFeatures = _streamFeatures({ middleware });
  const iqCaller = _iqCaller({ middleware, entity });
  const iqCallee = _iqCallee({ middleware, entity });
  const resolve = _resolve({ entity });
  // Stream features - order matters and define priority
  const sasl = _sasl({ streamFeatures }, credentials || { username, password });
  const streamManagement = _streamManagement({
    streamFeatures,
    entity,
    middleware,
  });
  const resourceBinding = _resourceBinding(
    { iqCaller, streamFeatures },
    resource,
  );
  const sessionEstablishment = _sessionEstablishment({
    iqCaller,
    streamFeatures,
  });
  // SASL mechanisms - order matters and define priority
  const mechanisms = Object.entries({ plain, anonymous }).map(([k, v]) => ({
    [k]: v(sasl),
  }));

  return Object.assign(entity, {
    entity,
    reconnect,
    websocket,
    middleware,
    streamFeatures,
    iqCaller,
    iqCallee,
    resolve,
    sasl,
    resourceBinding,
    sessionEstablishment,
    streamManagement,
    mechanisms,
  });
}

module.exports.xml = xml;
module.exports.jid = jid;
module.exports.client = client;

},{"./lib/getDomain":6,"@xmpp/client-core":3,"@xmpp/iq/callee":19,"@xmpp/iq/caller":20,"@xmpp/middleware":25,"@xmpp/reconnect":30,"@xmpp/resolve":31,"@xmpp/resource-binding":35,"@xmpp/sasl":38,"@xmpp/sasl-anonymous":36,"@xmpp/sasl-plain":37,"@xmpp/session-establishment":40,"@xmpp/stream-features":41,"@xmpp/stream-management":43,"@xmpp/websocket":44}],6:[function(require,module,exports){
"use strict";

module.exports = function getDomain(service) {
  const domain = service.split("://")[1] || service;
  return domain.split(":")[0].split("/")[0];
};

},{}],7:[function(require,module,exports){
"use strict";

const { EventEmitter, promise } = require("@xmpp/events");
const jid = require("@xmpp/jid");
const xml = require("@xmpp/xml");
const StreamError = require("./lib/StreamError");
const { parseHost, parseService } = require("./lib/util");

const NS_STREAM = "urn:ietf:params:xml:ns:xmpp-streams";
const NS_JABBER_STREAM = "http://etherx.jabber.org/streams";

class Connection extends EventEmitter {
  constructor(options = {}) {
    super();
    this.jid = null;
    this.timeout = 2000;
    this.options = options;
    this.socketListeners = Object.create(null);
    this.parserListeners = Object.create(null);
    this.status = "offline";
    this.socket = null;
    this.parser = null;
    this.root = null;
  }

  _reset() {
    this.jid = null;
    this.status = "offline";
    this._detachSocket();
    this._detachParser();
  }

  async _streamError(condition, children) {
    try {
      await this.send(
        // prettier-ignore
        xml('stream:error', {}, [
          xml(condition, {xmlns: NS_STREAM}, children),
        ]),
      );
    } catch {}

    return this._end();
  }

  _onData(data) {
    const str = data.toString("utf8");
    this.emit("input", str);
    this.parser.write(str);
  }

  _onParserError(error) {
    // https://xmpp.org/rfcs/rfc6120.html#streams-error-conditions-bad-format
    // "This error can be used instead of the more specific XML-related errors,
    // such as <bad-namespace-prefix/>, <invalid-xml/>, <not-well-formed/>, <restricted-xml/>,
    // and <unsupported-encoding/>. However, the more specific errors are RECOMMENDED."
    this._streamError("bad-format");
    this._detachParser();
    this.emit("error", error);
  }

  _attachSocket(socket) {
    this.socket = socket;
    const listeners = this.socketListeners;

    listeners.data = this._onData.bind(this);

    listeners.close = (dirty, event) => {
      this._reset();
      this._status("disconnect", { clean: !dirty, event });
    };

    listeners.connect = () => {
      this._status("connect");
    };

    listeners.error = (error) => {
      this.emit("error", error);
    };

    this.socket.on("close", listeners.close);
    this.socket.on("data", listeners.data);
    this.socket.on("error", listeners.error);
    this.socket.on("connect", listeners.connect);
  }

  _detachSocket() {
    const { socketListeners, socket } = this;
    for (const k of Object.getOwnPropertyNames(socketListeners)) {
      socket.removeListener(k, socketListeners[k]);
      delete socketListeners[k];
    }
    this.socket = null;
    return socket;
  }

  _onElement(element) {
    const isStreamError = element.is("error", NS_JABBER_STREAM);

    if (isStreamError) {
      this._onStreamError(element);
    }

    this.emit("element", element);
    this.emit(this.isStanza(element) ? "stanza" : "nonza", element);

    if (isStreamError) {
      // "Stream Errors Are Unrecoverable"
      // "The entity that receives the stream error then SHALL close the stream"
      this._end();
    }
  }

  // https://xmpp.org/rfcs/rfc6120.html#streams-error
  _onStreamError(element) {
    const error = StreamError.fromElement(element);

    if (error.condition === "see-other-host") {
      return this._onSeeOtherHost(error);
    }

    this.emit("error", error);
  }

  // https://xmpp.org/rfcs/rfc6120.html#streams-error-conditions-see-other-host
  async _onSeeOtherHost(error) {
    const { protocol } = parseService(this.options.service);

    const host = error.element.getChildText("see-other-host");
    const { port } = parseHost(host);

    let service;
    service = port
      ? `${protocol || "xmpp:"}//${host}`
      : (protocol ? `${protocol}//` : "") + host;

    try {
      await promise(this, "disconnect");
      const { domain, lang } = this.options;
      await this.connect(service);
      await this.open({ domain, lang });
    } catch (err) {
      this.emit("error", err);
    }
  }

  _attachParser(parser) {
    this.parser = parser;
    const listeners = this.parserListeners;

    listeners.element = this._onElement.bind(this);
    listeners.error = this._onParserError.bind(this);

    listeners.end = (element) => {
      this._detachParser();
      this._status("close", element);
    };

    listeners.start = (element) => {
      this._status("open", element);
    };

    this.parser.on("error", listeners.error);
    this.parser.on("element", listeners.element);
    this.parser.on("end", listeners.end);
    this.parser.on("start", listeners.start);
  }

  _detachParser() {
    const listeners = this.parserListeners;
    for (const k of Object.getOwnPropertyNames(listeners)) {
      this.parser.removeListener(k, listeners[k]);
      delete listeners[k];
    }
    this.parser = null;
  }

  _jid(id) {
    this.jid = jid(id);
    return this.jid;
  }

  _status(status, ...args) {
    this.status = status;
    this.emit("status", status, ...args);
    this.emit(status, ...args);
  }

  async _end() {
    let el;
    try {
      el = await this.close();
    } catch {}

    try {
      await this.disconnect();
    } catch {}

    return el;
  }

  /**
   * Opens the socket then opens the stream
   */
  async start() {
    if (this.status !== "offline") {
      throw new Error("Connection is not offline");
    }

    const { service, domain, lang } = this.options;

    await this.connect(service);

    const promiseOnline = promise(this, "online");

    await this.open({ domain, lang });

    return promiseOnline;
  }

  /**
   * Connects the socket
   */
  async connect(service) {
    this._status("connecting", service);
    const socket = new this.Socket();
    this._attachSocket(socket);
    // The 'connect' status is set by the socket 'connect' listener
    socket.connect(this.socketParameters(service));
    return promise(socket, "connect");
  }

  /**
   * Disconnects the socket
   * https://xmpp.org/rfcs/rfc6120.html#streams-close
   * https://tools.ietf.org/html/rfc7395#section-3.6
   */
  async disconnect(timeout = this.timeout) {
    if (this.socket) this._status("disconnecting");

    this.socket.end();

    // The 'disconnect' status is set by the socket 'close' listener
    await promise(this.socket, "close", "error", timeout);
  }

  /**
   * Opens the stream
   */
  async open(options) {
    this._status("opening");

    if (typeof options === "string") {
      options = { domain: options };
    }

    const { domain, lang, timeout = this.timeout } = options;

    const headerElement = this.headerElement();
    headerElement.attrs.to = domain;
    headerElement.attrs["xml:lang"] = lang;
    this.root = headerElement;

    this._attachParser(new this.Parser());

    await this.write(this.header(headerElement));
    return promise(this, "open", "error", timeout);
  }

  /**
   * Closes the stream then closes the socket
   * https://xmpp.org/rfcs/rfc6120.html#streams-close
   * https://tools.ietf.org/html/rfc7395#section-3.6
   */
  async stop() {
    const el = await this._end();
    if (this.status !== "offline") this._status("offline", el);
    return el;
  }

  /**
   * Closes the stream and wait for the server to close it
   * https://xmpp.org/rfcs/rfc6120.html#streams-close
   * https://tools.ietf.org/html/rfc7395#section-3.6
   */
  async close(timeout = this.timeout) {
    const fragment = this.footer(this.footerElement());

    const p = Promise.all([
      promise(this.parser, "end", "error", timeout),
      this.write(fragment),
    ]);

    if (this.parser && this.socket) this._status("closing");
    const [el] = await p;
    this.root = null;
    return el;
    // The 'close' status is set by the parser 'end' listener
  }

  /**
   * Restart the stream
   * https://xmpp.org/rfcs/rfc6120.html#streams-negotiation-restart
   */
  async restart() {
    this._detachParser();
    const { domain, lang } = this.options;
    return this.open({ domain, lang });
  }

  async send(element) {
    element.parent = this.root;
    await this.write(element.toString());
    this.emit("send", element);
  }

  sendReceive(element, timeout = this.timeout) {
    return Promise.all([
      this.send(element),
      promise(this, "element", "error", timeout),
    ]).then(([, el]) => el);
  }

  write(string) {
    return new Promise((resolve, reject) => {
      // https://xmpp.org/rfcs/rfc6120.html#streams-close
      // "Refrain from sending any further data over its outbound stream to the other entity"
      if (this.status === "closing") {
        reject(new Error("Connection is closing"));
        return;
      }

      this.socket.write(string, (err) => {
        if (err) {
          return reject(err);
        }

        this.emit("output", string);
        resolve();
      });
    });
  }

  isStanza(element) {
    const { name } = element;
    return name === "iq" || name === "message" || name === "presence";
  }

  isNonza(element) {
    return !this.isStanza(element);
  }

  // Override
  header(el) {
    return el.toString();
  }

  // Override
  headerElement() {
    return new xml.Element("", {
      version: "1.0",
      xmlns: this.NS,
    });
  }

  // Override
  footer(el) {
    return el.toString();
  }

  // Override
  footerElement() {}

  // Override
  socketParameters() {}
}

// Overrirde
Connection.prototype.NS = "";
Connection.prototype.Socket = null;
Connection.prototype.Parser = null;

module.exports = Connection;

},{"./lib/StreamError":8,"./lib/util":9,"@xmpp/events":12,"@xmpp/jid":21,"@xmpp/xml":48}],8:[function(require,module,exports){
"use strict";

const XMPPError = require("@xmpp/error");

// https://xmpp.org/rfcs/rfc6120.html#streams-error

class StreamError extends XMPPError {
  constructor(...args) {
    super(...args);
    this.name = "StreamError";
  }
}

module.exports = StreamError;

},{"@xmpp/error":11}],9:[function(require,module,exports){
"use strict";

function parseURI(URI) {
  let { port, hostname, protocol } = new URL(URI);
  // https://github.com/nodejs/node/issues/12410#issuecomment-294138912
  if (hostname === "[::1]") {
    hostname = "::1";
  }

  return { port, hostname, protocol };
}

function parseHost(host) {
  const { port, hostname } = parseURI(`http://${host}`);
  return { port, hostname };
}

function parseService(service) {
  return service.includes("://") ? parseURI(service) : parseHost(service);
}

Object.assign(module.exports, { parseURI, parseHost, parseService });

},{}],10:[function(require,module,exports){
(function (process){(function (){
"use strict";

/* eslint no-console: 0 */

const stringify = require("ltx/lib/stringify");
const xml = require("@xmpp/xml");
const clone = require("ltx/lib/clone");

const NS_SASL = "urn:ietf:params:xml:ns:xmpp-sasl";
const NS_COMPONENT = "jabber:component:accept";

const SENSITIVES = [
  ["handshake", NS_COMPONENT],
  ["auth", NS_SASL],
  ["challenge", NS_SASL],
  ["response", NS_SASL],
  ["success", NS_SASL],
];

function isSensitive(element) {
  if (element.children.length === 0) return false;
  return SENSITIVES.some((sensitive) => {
    return element.is(...sensitive);
  });
}

function hideSensitive(element) {
  if (isSensitive(element)) {
    element.children = [];
    element.append(xml("hidden", { xmlns: "xmpp.js" }));
  }

  return element;
}

function format(element) {
  return stringify(hideSensitive(clone(element), 2));
}

module.exports = function debug(entity, force) {
  if (process.env.XMPP_DEBUG || force === true) {
    entity.on("element", (data) => {
      console.debug(`IN\n${format(data)}`);
    });

    entity.on("send", (data) => {
      console.debug(`OUT\n${format(data)}`);
    });

    entity.on("error", console.error);

    entity.on("status", (status, value) => {
      console.debug("status", status, value ? value.toString() : "");
    });
  }
};

module.exports.hideSensitive = hideSensitive;

}).call(this)}).call(this,require('_process'))
},{"@xmpp/xml":48,"_process":61,"ltx/lib/clone":56,"ltx/lib/stringify":60}],11:[function(require,module,exports){
"use strict";

// https://xmpp.org/rfcs/rfc6120.html#rfc.section.4.9.2

class XMPPError extends Error {
  constructor(condition, text, application) {
    super(condition + (text ? ` - ${text}` : ""));
    this.name = "XMPPError";
    this.condition = condition;
    this.text = text;
    this.application = application;
  }

  static fromElement(element) {
    const [condition, second, third] = element.children;
    let text;
    let application;

    if (second) {
      if (second.is("text")) {
        text = second;
      } else if (second) {
        application = second;
      }

      if (third) application = third;
    }

    const error = new this(
      condition.name,
      text ? text.text() : "",
      application,
    );
    error.element = element;
    return error;
  }
}

module.exports = XMPPError;

},{}],12:[function(require,module,exports){
"use strict";

const timeout = require("./lib/timeout");
const delay = require("./lib/delay");
const TimeoutError = require("./lib/TimeoutError");
const promise = require("./lib/promise");
const EventEmitter = require("events");
const Deferred = require("./lib/Deferred");

exports.EventEmitter = EventEmitter;
exports.timeout = timeout;
exports.delay = delay;
exports.TimeoutError = TimeoutError;
exports.promise = promise;
exports.Deferred = Deferred;

},{"./lib/Deferred":13,"./lib/TimeoutError":14,"./lib/delay":15,"./lib/promise":16,"./lib/timeout":17,"events":53}],13:[function(require,module,exports){
"use strict";

module.exports = function Deferred() {
  this.promise = new Promise((resolve, reject) => {
    this.resolve = resolve;
    this.reject = reject;
  });
};

},{}],14:[function(require,module,exports){
"use strict";

module.exports = class TimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = "TimeoutError";
  }
};

},{}],15:[function(require,module,exports){
"use strict";

module.exports = function delay(ms) {
  let timeout;
  const promise = new Promise((resolve) => {
    timeout = setTimeout(resolve, ms);
  });
  promise.timeout = timeout;
  return promise;
};

},{}],16:[function(require,module,exports){
"use strict";

const TimeoutError = require("./TimeoutError");

module.exports = function promise(EE, event, rejectEvent = "error", timeout) {
  return new Promise((resolve, reject) => {
    let timeoutId;

    const cleanup = () => {
      clearTimeout(timeoutId);
      EE.removeListener(event, onEvent);
      EE.removeListener(rejectEvent, onError);
    };

    function onError(reason) {
      reject(reason);
      cleanup();
    }

    function onEvent(value) {
      resolve(value);
      cleanup();
    }

    EE.once(event, onEvent);
    if (rejectEvent) {
      EE.once(rejectEvent, onError);
    }

    if (timeout) {
      timeoutId = setTimeout(() => {
        cleanup();
        reject(new TimeoutError());
      }, timeout);
    }
  });
};

},{"./TimeoutError":14}],17:[function(require,module,exports){
"use strict";

const TimeoutError = require("./TimeoutError");
const delay = require("./delay");

module.exports = function timeout(promise, ms) {
  const promiseDelay = delay(ms);

  function cancelDelay() {
    clearTimeout(promiseDelay.timeout);
  }

  return Promise.race([
    promise.finally(cancelDelay),
    promiseDelay.then(() => {
      throw new TimeoutError();
    }),
  ]);
};

},{"./TimeoutError":14,"./delay":15}],18:[function(require,module,exports){
"use strict";

module.exports = function id() {
  let i;
  while (!i) {
    i = Math.random().toString(36).slice(2, 12);
  }

  return i;
};

},{}],19:[function(require,module,exports){
"use strict";

/**
 * References
 * https://xmpp.org/rfcs/rfc6120.html#stanzas-semantics-iq
 * https://xmpp.org/rfcs/rfc6120.html#stanzas-error
 */

const xml = require("@xmpp/xml");

const NS_STANZA = "urn:ietf:params:xml:ns:xmpp-stanzas";

function isQuery({ name, type }) {
  if (name !== "iq") return false;
  if (type === "error" || type === "result") return false;
  return true;
}

function isValidQuery({ type }, children, child) {
  if (type !== "get" && type !== "set") return false;
  if (children.length !== 1) return false;
  if (!child) return false;
  return true;
}

function buildReply({ stanza }) {
  return xml("iq", {
    to: stanza.attrs.from,
    from: stanza.attrs.to,
    id: stanza.attrs.id,
  });
}

function buildReplyResult(ctx, child) {
  const reply = buildReply(ctx);
  reply.attrs.type = "result";
  if (child) {
    reply.append(child);
  }

  return reply;
}

function buildReplyError(ctx, error, child) {
  const reply = buildReply(ctx);
  reply.attrs.type = "error";
  if (child) {
    reply.append(child);
  }

  reply.append(error);
  return reply;
}

function buildError(type, condition) {
  return xml("error", { type }, xml(condition, NS_STANZA));
}

function iqHandler(entity) {
  return async function iqHandler(ctx, next) {
    if (!isQuery(ctx)) return next();

    const { stanza } = ctx;
    const children = stanza.getChildElements();
    const [child] = children;

    if (!isValidQuery(ctx, children, child)) {
      return buildReplyError(ctx, buildError("modify", "bad-request"), child);
    }

    ctx.element = child;

    let reply;
    try {
      reply = await next();
    } catch (err) {
      entity.emit("error", err);
      reply = buildError("cancel", "internal-server-error");
    }

    if (!reply) {
      reply = buildError("cancel", "service-unavailable");
    }

    if (reply instanceof xml.Element && reply.is("error")) {
      return buildReplyError(ctx, reply, child);
    }

    return buildReplyResult(
      ctx,
      reply instanceof xml.Element ? reply : undefined,
    );
  };
}

function route(type, ns, name, handler) {
  return (ctx, next) => {
    if ((ctx.type !== type) | !ctx.element || !ctx.element.is(name, ns))
      return next();
    return handler(ctx, next);
  };
}

module.exports = function iqCallee({ middleware, entity }) {
  middleware.use(iqHandler(entity));

  return {
    get(ns, name, handler) {
      middleware.use(route("get", ns, name, handler));
    },
    set(ns, name, handler) {
      middleware.use(route("set", ns, name, handler));
    },
  };
};

},{"@xmpp/xml":48}],20:[function(require,module,exports){
"use strict";

const xid = require("@xmpp/id");
const StanzaError = require("@xmpp/middleware/lib/StanzaError");
const { Deferred } = require("@xmpp/events");
const timeoutPromise = require("@xmpp/events").timeout;
const xml = require("@xmpp/xml");

function isReply({ name, type }) {
  if (name !== "iq") return false;
  if (type !== "error" && type !== "result") return false;
  return true;
}

class IQCaller {
  constructor({ entity, middleware }) {
    this.handlers = new Map();
    this.entity = entity;
    this.middleware = middleware;
  }

  start() {
    this.middleware.use(this._route.bind(this));
  }

  _route({ type, name, id, stanza }, next) {
    if (!isReply({ name, type })) return next();

    const deferred = this.handlers.get(id);

    if (!deferred) {
      return next();
    }

    if (type === "error") {
      deferred.reject(StanzaError.fromElement(stanza.getChild("error")));
    } else {
      deferred.resolve(stanza);
    }

    this.handlers.delete(id);
  }

  async request(stanza, timeout = 30 * 1000) {
    if (!stanza.attrs.id) {
      stanza.attrs.id = xid();
    }

    const deferred = new Deferred();
    this.handlers.set(stanza.attrs.id, deferred);

    try {
      await this.entity.send(stanza);
      await timeoutPromise(deferred.promise, timeout);
    } catch (err) {
      this.handlers.delete(stanza.attrs.id);
      throw err;
    }

    return deferred.promise;
  }

  _childRequest(type, element, to, ...args) {
    const {
      name,
      attrs: { xmlns },
    } = element;
    return this.request(xml("iq", { type, to }, element), ...args).then(
      (stanza) => stanza.getChild(name, xmlns),
    );
  }

  async get(...args) {
    return this._childRequest("get", ...args);
  }

  async set(...args) {
    return this._childRequest("set", ...args);
  }
}

module.exports = function iqCaller(...args) {
  const iqCaller = new IQCaller(...args);
  iqCaller.start();
  return iqCaller;
};

},{"@xmpp/events":12,"@xmpp/id":18,"@xmpp/middleware/lib/StanzaError":29,"@xmpp/xml":48}],21:[function(require,module,exports){
"use strict";

const JID = require("./lib/JID");
const escaping = require("./lib/escaping");
const parse = require("./lib/parse");

function jid(...args) {
  if (!args[1] && !args[2]) {
    return parse(...args);
  }

  return new JID(...args);
}

module.exports = jid.bind();
module.exports.jid = jid;
module.exports.JID = JID;
module.exports.equal = function equal(a, b) {
  return a.equals(b);
};

module.exports.detectEscape = escaping.detect;
module.exports.escapeLocal = escaping.escape;
module.exports.unescapeLocal = escaping.unescape;
module.exports.parse = parse;

},{"./lib/JID":22,"./lib/escaping":23,"./lib/parse":24}],22:[function(require,module,exports){
"use strict";

const escaping = require("./escaping");

/**
 * JID implements
 * - XMPP addresses according to RFC6122
 * - XEP-0106: JID Escaping
 *
 * @see http://tools.ietf.org/html/rfc6122#section-2
 * @see http://xmpp.org/extensions/xep-0106.html
 */
class JID {
  constructor(local, domain, resource) {
    if (typeof domain !== "string" || !domain) {
      throw new TypeError(`Invalid domain.`);
    }

    this.setDomain(domain);
    this.setLocal(typeof local === "string" ? local : "");
    this.setResource(typeof resource === "string" ? resource : "");
  }

  [Symbol.toPrimitive](hint) {
    if (hint === "number") {
      return NaN;
    }

    return this.toString();
  }

  toString(unescape) {
    let s = this._domain;
    if (this._local) {
      s = this.getLocal(unescape) + "@" + s;
    }

    if (this._resource) {
      s = s + "/" + this._resource;
    }

    return s;
  }

  /**
   * Convenience method to distinguish users
   * */
  bare() {
    if (this._resource) {
      return new JID(this._local, this._domain, null);
    }

    return this;
  }

  /**
   * Comparison function
   * */
  equals(other) {
    return (
      this._local === other._local &&
      this._domain === other._domain &&
      this._resource === other._resource
    );
  }

  /**
   * http://xmpp.org/rfcs/rfc6122.html#addressing-localpart
   * */
  setLocal(local, escape) {
    escape = escape || escaping.detect(local);

    if (escape) {
      local = escaping.escape(local);
    }

    this._local = local && local.toLowerCase();
    return this;
  }

  getLocal(unescape = false) {
    let local = null;

    local = unescape ? escaping.unescape(this._local) : this._local;

    return local;
  }

  /**
   * http://xmpp.org/rfcs/rfc6122.html#addressing-domain
   */
  setDomain(domain) {
    this._domain = domain.toLowerCase();
    return this;
  }

  getDomain() {
    return this._domain;
  }

  /**
   * http://xmpp.org/rfcs/rfc6122.html#addressing-resourcepart
   */
  setResource(resource) {
    this._resource = resource;
    return this;
  }

  getResource() {
    return this._resource;
  }
}

Object.defineProperty(JID.prototype, "local", {
  get: JID.prototype.getLocal,
  set: JID.prototype.setLocal,
});

Object.defineProperty(JID.prototype, "domain", {
  get: JID.prototype.getDomain,
  set: JID.prototype.setDomain,
});

Object.defineProperty(JID.prototype, "resource", {
  get: JID.prototype.getResource,
  set: JID.prototype.setResource,
});

module.exports = JID;

},{"./escaping":23}],23:[function(require,module,exports){
"use strict";

module.exports.detect = function detect(local) {
  if (!local) {
    return false;
  }

  // Remove all escaped sequences
  const tmp = local
    .replace(/\\20/g, "")
    .replace(/\\22/g, "")
    .replace(/\\26/g, "")
    .replace(/\\27/g, "")
    .replace(/\\2f/g, "")
    .replace(/\\3a/g, "")
    .replace(/\\3c/g, "")
    .replace(/\\3e/g, "")
    .replace(/\\40/g, "")
    .replace(/\\5c/g, "");

  // Detect if we have unescaped sequences
  const search = tmp.search(/[ "&'/:<>@\\]/g);
  if (search === -1) {
    return false;
  }

  return true;
};

/**
 * Escape the local part of a JID.
 *
 * @see http://xmpp.org/extensions/xep-0106.html
 * @param String local local part of a jid
 * @return An escaped local part
 */
module.exports.escape = function escape(local) {
  if (local === null) {
    return null;
  }

  return local
    .replace(/^\s+|\s+$/g, "")
    .replace(/\\/g, "\\5c")
    .replace(/ /g, "\\20")
    .replace(/"/g, "\\22")
    .replace(/&/g, "\\26")
    .replace(/'/g, "\\27")
    .replace(/\//g, "\\2f")
    .replace(/:/g, "\\3a")
    .replace(/</g, "\\3c")
    .replace(/>/g, "\\3e")
    .replace(/@/g, "\\40");
};

/**
 * Unescape a local part of a JID.
 *
 * @see http://xmpp.org/extensions/xep-0106.html
 * @param String local local part of a jid
 * @return unescaped local part
 */
module.exports.unescape = function unescape(local) {
  if (local === null) {
    return null;
  }

  return local
    .replace(/\\20/g, " ")
    .replace(/\\22/g, '"')
    .replace(/\\26/g, "&")
    .replace(/\\27/g, "'")
    .replace(/\\2f/g, "/")
    .replace(/\\3a/g, ":")
    .replace(/\\3c/g, "<")
    .replace(/\\3e/g, ">")
    .replace(/\\40/g, "@")
    .replace(/\\5c/g, "\\");
};

},{}],24:[function(require,module,exports){
"use strict";

const JID = require("../lib/JID");

module.exports = function parse(s) {
  let local;
  let resource;

  const resourceStart = s.indexOf("/");
  if (resourceStart !== -1) {
    resource = s.slice(resourceStart + 1);
    s = s.slice(0, resourceStart);
  }

  const atStart = s.indexOf("@");
  if (atStart !== -1) {
    local = s.slice(0, atStart);
    s = s.slice(atStart + 1);
  }

  return new JID(local, s, resource);
};

},{"../lib/JID":22}],25:[function(require,module,exports){
"use strict";

const compose = require("koa-compose");

const IncomingContext = require("./lib/IncomingContext");
const OutgoingContext = require("./lib/OutgoingContext");

function listener(entity, middleware, Context) {
  return (stanza) => {
    const ctx = new Context(entity, stanza);
    return compose(middleware)(ctx);
  };
}

function errorHandler(entity) {
  return (ctx, next) => {
    next()
      .then((reply) => reply && entity.send(reply))
      .catch((err) => entity.emit("error", err));
  };
}

module.exports = function middleware({ entity }) {
  const incoming = [errorHandler(entity)];
  const outgoing = [];

  const incomingListener = listener(entity, incoming, IncomingContext);
  const outgoingListener = listener(entity, outgoing, OutgoingContext);

  entity.on("element", incomingListener);
  entity.hookOutgoing = outgoingListener;

  return {
    use(fn) {
      incoming.push(fn);
      return fn;
    },
    filter(fn) {
      outgoing.push(fn);
      return fn;
    },
  };
};

},{"./lib/IncomingContext":27,"./lib/OutgoingContext":28,"koa-compose":54}],26:[function(require,module,exports){
"use strict";

module.exports = class Context {
  constructor(entity, stanza) {
    this.stanza = stanza;
    this.entity = entity;

    const { name, attrs } = stanza;
    const { type, id } = attrs;

    this.name = name;
    this.id = id || "";

    if (name === "message") {
      this.type = type || "normal";
    } else if (name === "presence") {
      this.type = type || "available";
    } else {
      this.type = type || "";
    }

    this.from = null;
    this.to = null;
    this.local = "";
    this.domain = "";
    this.resource = "";
  }
};

},{}],27:[function(require,module,exports){
"use strict";

const Context = require("./Context");
const JID = require("@xmpp/jid");

module.exports = class IncomingContext extends Context {
  constructor(entity, stanza) {
    super(entity, stanza);

    const { jid, domain } = entity;

    const to = stanza.attrs.to || (jid && jid.toString());
    const from = stanza.attrs.from || domain;

    if (to) this.to = new JID(to);

    if (from) {
      this.from = new JID(from);
      this.local = this.from.local;
      this.domain = this.from.domain;
      this.resource = this.from.resource;
    }
  }
};

},{"./Context":26,"@xmpp/jid":21}],28:[function(require,module,exports){
"use strict";

const Context = require("./Context");
const JID = require("@xmpp/jid");

module.exports = class OutgoingContext extends Context {
  constructor(entity, stanza) {
    super(entity, stanza);

    const { jid, domain } = entity;

    const from = stanza.attrs.from || (jid && jid.toString());
    const to = stanza.attrs.to || domain;

    if (from) this.from = new JID(from);

    if (to) {
      this.to = new JID(to);
      this.local = this.to.local;
      this.domain = this.to.domain;
      this.resource = this.to.resource;
    }
  }
};

},{"./Context":26,"@xmpp/jid":21}],29:[function(require,module,exports){
"use strict";

/* https://xmpp.org/rfcs/rfc6120.html#stanzas-error */

const XMPPError = require("@xmpp/error");

class StanzaError extends XMPPError {
  constructor(condition, text, application, type) {
    super(condition, text, application);
    this.type = type;
    this.name = "StanzaError";
  }

  static fromElement(element) {
    const error = super.fromElement(element);
    error.type = element.attrs.type;
    return error;
  }
}

module.exports = StanzaError;

},{"@xmpp/error":11}],30:[function(require,module,exports){
"use strict";

const { EventEmitter } = require("@xmpp/events");

class Reconnect extends EventEmitter {
  constructor(entity) {
    super();

    this.delay = 1000;
    this.entity = entity;
    this._timeout = null;
  }

  scheduleReconnect() {
    const { entity, delay, _timeout } = this;
    clearTimeout(_timeout);
    this._timeout = setTimeout(async () => {
      if (entity.status !== "disconnect") {
        return;
      }

      try {
        await this.reconnect();
      } catch {
        // Ignoring the rejection is safe because the error is emitted on entity by #start
      }
    }, delay);
  }

  async reconnect() {
    const { entity } = this;
    this.emit("reconnecting");

    const { service, domain, lang } = entity.options;
    await entity.connect(service);
    await entity.open({ domain, lang });

    this.emit("reconnected");
  }

  start() {
    const { entity } = this;
    const listeners = {};
    listeners.disconnect = () => {
      this.scheduleReconnect();
    };

    this.listeners = listeners;
    entity.on("disconnect", listeners.disconnect);
  }

  stop() {
    const { entity, listeners, _timeout } = this;
    entity.removeListener("disconnect", listeners.disconnect);
    clearTimeout(_timeout);
  }
}

module.exports = function reconnect({ entity }) {
  const r = new Reconnect(entity);
  r.start();
  return r;
};

},{"@xmpp/events":12}],31:[function(require,module,exports){
"use strict";

const resolve = require("./resolve");
const { promise } = require("@xmpp/events");

async function fetchURIs(domain) {
  const result = await resolve(domain, {
    srv: [
      {
        service: "xmpps-client",
        protocol: "tcp",
      },
      {
        service: "xmpp-client",
        protocol: "tcp",
      },
    ],
  });

  return [
    // Remove duplicates
    ...new Set(result.map((record) => record.uri)),
  ];
}

function filterSupportedURIs(entity, uris) {
  return uris.filter((uri) => entity._findTransport(uri));
}

async function fallbackConnect(entity, uris) {
  if (uris.length === 0) {
    throw new Error("Couldn't connect");
  }

  const uri = uris.shift();
  const Transport = entity._findTransport(uri);

  if (!Transport) {
    return fallbackConnect(entity, uris);
  }

  entity._status("connecting", uri);
  const params = Transport.prototype.socketParameters(uri);
  const socket = new Transport.prototype.Socket();

  try {
    socket.connect(params);
    await promise(socket, "connect");
  } catch {
    return fallbackConnect(entity, uris);
  }

  entity._attachSocket(socket);
  socket.emit("connect");
  entity.Transport = Transport;
  entity.Socket = Transport.prototype.Socket;
  entity.Parser = Transport.prototype.Parser;
}

module.exports = function resolve({ entity }) {
  const _connect = entity.connect;
  entity.connect = async function connect(service) {
    if (!service || /:\/\//.test(service)) {
      return _connect.call(this, service);
    }

    const uris = filterSupportedURIs(entity, await fetchURIs(service));

    if (uris.length === 0) {
      throw new Error("No compatible transport found.");
    }

    try {
      await fallbackConnect(entity, uris);
    } catch (err) {
      entity._reset();
      entity._status("disconnect");
      throw err;
    }
  };
};

},{"./resolve":34,"@xmpp/events":12}],32:[function(require,module,exports){
"use strict";

function isSecure(uri) {
  return uri.startsWith("https") || uri.startsWith("wss");
}

module.exports.compare = function compare(a, b) {
  let secure;
  if (isSecure(a.uri) && !isSecure(b.uri)) {
    secure = -1;
  } else if (!isSecure(a.uri) && isSecure(b.uri)) {
    secure = 1;
  } else {
    secure = 0;
  }

  if (secure !== 0) {
    return secure;
  }

  let method;
  if (a.method === b.method) {
    method = 0;
  } else if (a.method === "websocket") {
    method = -1;
  } else if (b.method === "websocket") {
    method = 1;
  } else if (a.method === "xbosh") {
    method = -1;
  } else if (b.method === "xbosh") {
    method = 1;
  } else if (a.method === "httppoll") {
    method = -1;
  } else if (b.method === "httppoll") {
    method = 1;
  } else {
    method = 0;
  }

  if (method !== 0) {
    return method;
  }

  return 0;
};

},{}],33:[function(require,module,exports){
(function (global){(function (){
"use strict";

const fetch = global.fetch || require("node-fetch");
const parse = require("@xmpp/xml/lib/parse");
const compareAltConnections = require("./alt-connections").compare;

function resolve(domain) {
  return fetch(`https://${domain}/.well-known/host-meta`)
    .then((res) => res.text())
    .then((res) => {
      return parse(res)
        .getChildren("Link")
        .filter((link) =>
          [
            "urn:xmpp:alt-connections:websocket",
            "urn:xmpp:alt-connections:httppoll",
            "urn:xmpp:alt-connections:xbosh",
          ].includes(link.attrs.rel),
        )
        .map(({ attrs }) => ({
          rel: attrs.rel,
          href: attrs.href,
          method: attrs.rel.split(":").pop(),
          uri: attrs.href,
        }))
        .sort(compareAltConnections);
    })
    .catch(() => {
      return [];
    });
}

module.exports.resolve = resolve;

}).call(this)}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./alt-connections":32,"@xmpp/xml/lib/parse":51,"node-fetch":52}],34:[function(require,module,exports){
"use strict";

const dns = require("./lib/dns");
const http = require("./lib/http");

module.exports = function resolve(...args) {
  return Promise.all([
    dns.resolve ? dns.resolve(...args) : Promise.resolve([]),
    http.resolve(...args),
  ]).then(([records, endpoints]) => [...records, ...endpoints]);
};

if (dns.resolve) {
  module.exports.dns = dns;
}

module.exports.http = http;

},{"./lib/dns":52,"./lib/http":33}],35:[function(require,module,exports){
"use strict";

const xml = require("@xmpp/xml");

/*
 * References
 * https://xmpp.org/rfcs/rfc6120.html#bind
 */

const NS = "urn:ietf:params:xml:ns:xmpp-bind";

function makeBindElement(resource) {
  return xml("bind", { xmlns: NS }, resource && xml("resource", {}, resource));
}

async function bind(entity, iqCaller, resource) {
  const result = await iqCaller.set(makeBindElement(resource));
  const jid = result.getChildText("jid");
  entity._jid(jid);
  return jid;
}

function route({ iqCaller }, resource) {
  return async ({ entity }, next) => {
    await (typeof resource === "function"
      ? resource((resource) => bind(entity, iqCaller, resource))
      : bind(entity, iqCaller, resource));

    next();
  };
}

module.exports = function resourceBinding(
  { streamFeatures, iqCaller },
  resource,
) {
  streamFeatures.use("bind", NS, route({ iqCaller }, resource));
};

},{"@xmpp/xml":48}],36:[function(require,module,exports){
"use strict";

/**
 * [XEP-0175: Best Practices for Use of SASL ANONYMOUS](https://xmpp.org/extensions/xep-0175.html)
 * [RFC-4504: Anonymous Simple Authentication and Security Layer (SASL) Mechanism](https://tools.ietf.org/html/rfc4505)
 */

const mech = require("sasl-anonymous");

module.exports = function saslAnonymous(sasl) {
  sasl.use(mech);
};

},{"sasl-anonymous":63}],37:[function(require,module,exports){
"use strict";

const mech = require("sasl-plain");

module.exports = function saslPlain(sasl) {
  sasl.use(mech);
};

},{"sasl-plain":65}],38:[function(require,module,exports){
"use strict";

const { encode, decode } = require("@xmpp/base64");
const SASLError = require("./lib/SASLError");
const xml = require("@xmpp/xml");
const SASLFactory = require("saslmechanisms");

// https://xmpp.org/rfcs/rfc6120.html#sasl

const NS = "urn:ietf:params:xml:ns:xmpp-sasl";

function getMechanismNames(features) {
  return features.getChild("mechanisms", NS).children.map((el) => el.text());
}

async function authenticate(SASL, entity, mechname, credentials) {
  const mech = SASL.create([mechname]);
  if (!mech) {
    throw new Error("No compatible mechanism");
  }

  const { domain } = entity.options;
  const creds = {
    username: null,
    password: null,
    server: domain,
    host: domain,
    realm: domain,
    serviceType: "xmpp",
    serviceName: domain,
    ...credentials,
  };

  return new Promise((resolve, reject) => {
    const handler = (element) => {
      if (element.attrs.xmlns !== NS) {
        return;
      }

      if (element.name === "challenge") {
        mech.challenge(decode(element.text()));
        const resp = mech.response(creds);
        entity.send(
          xml(
            "response",
            { xmlns: NS, mechanism: mech.name },
            typeof resp === "string" ? encode(resp) : "",
          ),
        );
        return;
      }

      if (element.name === "failure") {
        reject(SASLError.fromElement(element));
      } else if (element.name === "success") {
        resolve();
      }

      entity.removeListener("nonza", handler);
    };

    entity.on("nonza", handler);

    if (mech.clientFirst) {
      entity.send(
        xml(
          "auth",
          { xmlns: NS, mechanism: mech.name },
          encode(mech.response(creds)),
        ),
      );
    }
  });
}

module.exports = function sasl({ streamFeatures }, credentials) {
  const SASL = new SASLFactory();

  streamFeatures.use("mechanisms", NS, async ({ stanza, entity }) => {
    const offered = getMechanismNames(stanza);
    const supported = SASL._mechs.map(({ name }) => name);
    // eslint-disable-next-line unicorn/prefer-array-find
    const intersection = supported.filter((mech) => {
      return offered.includes(mech);
    });
    // eslint-disable-next-line prefer-destructuring
    let mech = intersection[0];

    if (typeof credentials === "function") {
      await credentials(
        (creds) => authenticate(SASL, entity, mech, creds, stanza),
        mech,
      );
    } else {
      if (!credentials.username && !credentials.password) {
        mech = "ANONYMOUS";
      }

      await authenticate(SASL, entity, mech, credentials, stanza);
    }

    await entity.restart();
  });

  return {
    use(...args) {
      return SASL.use(...args);
    },
  };
};

},{"./lib/SASLError":39,"@xmpp/base64":2,"@xmpp/xml":48,"saslmechanisms":67}],39:[function(require,module,exports){
"use strict";

const XMPPError = require("@xmpp/error");

// https://xmpp.org/rfcs/rfc6120.html#sasl-errors

class SASLError extends XMPPError {
  constructor(...args) {
    super(...args);
    this.name = "SASLError";
  }
}

module.exports = SASLError;

},{"@xmpp/error":11}],40:[function(require,module,exports){
"use strict";

const xml = require("@xmpp/xml");

// https://tools.ietf.org/html/draft-cridland-xmpp-session-01

const NS = "urn:ietf:params:xml:ns:xmpp-session";

module.exports = function sessionEstablishment({ iqCaller, streamFeatures }) {
  streamFeatures.use("session", NS, async (context, next, feature) => {
    if (feature.getChild("optional")) return next();
    await iqCaller.set(xml("session", NS));
    return next();
  });
};

},{"@xmpp/xml":48}],41:[function(require,module,exports){
"use strict";

/**
 * References
 * https://xmpp.org/rfcs/rfc6120.html#streams-negotiation Stream Negotiation
 * https://xmpp.org/extensions/xep-0170.html XEP-0170: Recommended Order of Stream Feature Negotiation
 * https://xmpp.org/registrar/stream-features.html XML Stream Features
 */

const route = require("./route");

module.exports = function streamFeatures({ middleware }) {
  middleware.use(route());

  function use(name, xmlns, handler) {
    return middleware.use((ctx, next) => {
      const { stanza } = ctx;
      if (!stanza.is("features", "http://etherx.jabber.org/streams"))
        return next();
      const feature = stanza.getChild(name, xmlns);
      if (!feature) return next();
      return handler(ctx, next, feature);
    });
  }

  return {
    use,
  };
};

},{"./route":42}],42:[function(require,module,exports){
"use strict";

module.exports = function route() {
  return async ({ stanza, entity }, next) => {
    if (!stanza.is("features", "http://etherx.jabber.org/streams"))
      return next();

    const prevent = await next();
    if (!prevent && entity.jid) entity._status("online", entity.jid);
  };
};

},{}],43:[function(require,module,exports){
"use strict";

const xml = require("@xmpp/xml");

// https://xmpp.org/extensions/xep-0198.html

const NS = "urn:xmpp:sm:3";

async function enable(entity, resume, max) {
  entity.send(
    xml("enable", { xmlns: NS, max, resume: resume ? "true" : undefined }),
  );

  return new Promise((resolve, reject) => {
    function listener(nonza) {
      if (nonza.is("enabled", NS)) {
        resolve(nonza);
      } else if (nonza.is("failed", NS)) {
        reject(nonza);
      } else {
        return;
      }

      entity.removeListener("nonza", listener);
    }

    entity.on("nonza", listener);
  });
}

async function resume(entity, h, previd) {
  const response = await entity.sendReceive(
    xml("resume", { xmlns: NS, h, previd }),
  );

  if (!response.is("resumed", NS)) {
    throw response;
  }

  return response;
}

module.exports = function streamManagement({
  streamFeatures,
  entity,
  middleware,
}) {
  let address = null;

  const sm = {
    allowResume: true,
    preferredMaximum: null,
    enabled: false,
    id: "",
    outbound: 0,
    inbound: 0,
    max: null,
  };

  entity.on("online", (jid) => {
    address = jid;
    sm.outbound = 0;
    sm.inbound = 0;
  });

  entity.on("offline", () => {
    sm.outbound = 0;
    sm.inbound = 0;
    sm.enabled = false;
    sm.id = "";
  });

  middleware.use((context, next) => {
    const { stanza } = context;
    if (["presence", "message", "iq"].includes(stanza.name)) {
      sm.inbound += 1;
    } else if (stanza.is("r", NS)) {
      // > When an <r/> element ("request") is received, the recipient MUST acknowledge it by sending an <a/> element to the sender containing a value of 'h' that is equal to the number of stanzas handled by the recipient of the <r/> element.
      entity.send(xml("a", { xmlns: NS, h: sm.inbound })).catch(() => {});
    } else if (stanza.is("a", NS)) {
      // > When a party receives an <a/> element, it SHOULD keep a record of the 'h' value returned as the sequence number of the last handled outbound stanza for the current stream (and discard the previous value).
      sm.outbound = stanza.attrs.h;
    }

    return next();
  });

  // https://xmpp.org/extensions/xep-0198.html#enable
  // For client-to-server connections, the client MUST NOT attempt to enable stream management until after it has completed Resource Binding unless it is resuming a previous session

  streamFeatures.use("sm", NS, async (context, next) => {
    // Resuming
    if (sm.id) {
      try {
        await resume(entity, sm.inbound, sm.id);
        sm.enabled = true;
        entity.jid = address;
        entity.status = "online";
        return true;
        // If resumption fails, continue with session establishment
        // eslint-disable-next-line no-unused-vars
      } catch {
        sm.id = "";
        sm.enabled = false;
        sm.outbound = 0;
      }
    }

    // Enabling

    // Resource binding first
    await next();

    const promiseEnable = enable(entity, sm.allowResume, sm.preferredMaximum);

    // > The counter for an entity's own sent stanzas is set to zero and started after sending either <enable/> or <enabled/>.
    sm.outbound = 0;

    try {
      const response = await promiseEnable;
      sm.enabled = true;
      sm.id = response.attrs.id;
      sm.max = response.attrs.max;
      // eslint-disable-next-line no-unused-vars
    } catch {
      sm.enabled = false;
    }

    sm.inbound = 0;
  });

  return sm;
};

},{"@xmpp/xml":48}],44:[function(require,module,exports){
"use strict";

const ConnectionWebSocket = require("./lib/Connection");

module.exports = function websocket({ entity }) {
  entity.transports.push(ConnectionWebSocket);
};

},{"./lib/Connection":45}],45:[function(require,module,exports){
"use strict";

const Socket = require("./Socket");
const Connection = require("@xmpp/connection");
const xml = require("@xmpp/xml");
const FramedParser = require("./FramedParser");

const NS_FRAMING = "urn:ietf:params:xml:ns:xmpp-framing";

/* References
 * WebSocket protocol https://tools.ietf.org/html/rfc6455
 * WebSocket Web API https://html.spec.whatwg.org/multipage/comms.html#network
 * XMPP over WebSocket https://tools.ietf.org/html/rfc7395
 */

class ConnectionWebSocket extends Connection {
  send(element, ...args) {
    if (!element.attrs.xmlns && super.isStanza(element)) {
      element.attrs.xmlns = "jabber:client";
    }

    return super.send(element, ...args);
  }

  async sendMany(elements) {
    for (const element of elements) {
      await this.send(element);
    }
  }

  // https://tools.ietf.org/html/rfc7395#section-3.6
  footerElement() {
    return new xml.Element("close", {
      xmlns: NS_FRAMING,
    });
  }

  // https://tools.ietf.org/html/rfc7395#section-3.4
  headerElement() {
    const el = super.headerElement();
    el.name = "open";
    el.attrs.xmlns = NS_FRAMING;
    return el;
  }

  socketParameters(service) {
    return /^wss?:\/\//.test(service) ? service : undefined;
  }
}

ConnectionWebSocket.prototype.Socket = Socket;
ConnectionWebSocket.prototype.NS = "jabber:client";
ConnectionWebSocket.prototype.Parser = FramedParser;

module.exports = ConnectionWebSocket;

},{"./FramedParser":46,"./Socket":47,"@xmpp/connection":7,"@xmpp/xml":48}],46:[function(require,module,exports){
"use strict";

const { Parser, Element, XMLError } = require("@xmpp/xml");

module.exports = class FramedParser extends Parser {
  onStartElement(name, attrs) {
    const element = new Element(name, attrs);

    const { cursor } = this;

    if (cursor) {
      cursor.append(element);
    }

    this.cursor = element;
  }

  onEndElement(name) {
    const { cursor } = this;
    if (name !== cursor.name) {
      // <foo></bar>
      this.emit("error", new XMLError(`${cursor.name} must be closed.`));
      return;
    }

    if (cursor.parent) {
      this.cursor = cursor.parent;
      return;
    }

    if (cursor.is("open", "urn:ietf:params:xml:ns:xmpp-framing")) {
      this.emit("start", cursor);
    } else if (cursor.is("close", "urn:ietf:params:xml:ns:xmpp-framing")) {
      this.emit("end", cursor);
    } else {
      this.emit("element", cursor);
    }

    this.cursor = null;
  }
};

},{"@xmpp/xml":48}],47:[function(require,module,exports){
(function (global){(function (){
"use strict";

const WS = require("ws");
const WebSocket = global.WebSocket || WS;
const EventEmitter = require("events");

const CODE = "ECONNERROR";

class Socket extends EventEmitter {
  constructor() {
    super();
    this.listeners = Object.create(null);
  }

  connect(url) {
    this.url = url;
    this._attachSocket(new WebSocket(url, ["xmpp"]));
  }

  _attachSocket(socket) {
    this.socket = socket;
    const { listeners } = this;
    listeners.open = () => {
      this.emit("connect");
    };

    listeners.message = ({ data }) => this.emit("data", data);
    listeners.error = (event) => {
      const { url } = this;
      // WS
      let { error } = event;
      // DOM
      if (!error) {
        error = new Error(`WebSocket ${CODE} ${url}`);
        error.errno = CODE;
        error.code = CODE;
      }

      error.event = event;
      error.url = url;
      this.emit("error", error);
    };

    listeners.close = (event) => {
      this._detachSocket();
      this.emit("close", !event.wasClean, event);
    };

    this.socket.addEventListener("open", listeners.open);
    this.socket.addEventListener("message", listeners.message);
    this.socket.addEventListener("error", listeners.error);
    this.socket.addEventListener("close", listeners.close);
  }

  _detachSocket() {
    delete this.url;
    const { socket, listeners } = this;
    for (const k of Object.getOwnPropertyNames(listeners)) {
      socket.removeEventListener(k, listeners[k]);
      delete listeners[k];
    }
    delete this.socket;
  }

  end() {
    this.socket.close();
  }

  write(data, fn) {
    if (WebSocket === WS) {
      this.socket.send(data, fn);
    } else {
      this.socket.send(data);
      fn();
    }
  }
}

module.exports = Socket;

}).call(this)}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"events":53,"ws":52}],48:[function(require,module,exports){
"use strict";

const Element = require("ltx/lib/Element");
const createElement = require("ltx/lib/createElement");
const Parser = require("./lib/Parser");
const {
  escapeXML,
  unescapeXML,
  escapeXMLText,
  unescapeXMLText,
} = require("ltx/lib/escape");
const XMLError = require("./lib/XMLError");

function xml(...args) {
  return createElement(...args);
}

module.exports = xml;

Object.assign(module.exports, {
  Element,
  createElement,
  Parser,
  escapeXML,
  unescapeXML,
  escapeXMLText,
  unescapeXMLText,
  XMLError,
});

},{"./lib/Parser":49,"./lib/XMLError":50,"ltx/lib/Element":55,"ltx/lib/createElement":57,"ltx/lib/escape":58}],49:[function(require,module,exports){
"use strict";

const LtxParser = require("ltx/lib/parsers/ltx");
const Element = require("ltx/lib/Element");
const EventEmitter = require("events");
const XMLError = require("./XMLError");

class Parser extends EventEmitter {
  constructor() {
    super();
    const parser = new LtxParser();
    this.root = null;
    this.cursor = null;

    parser.on("startElement", this.onStartElement.bind(this));
    parser.on("endElement", this.onEndElement.bind(this));
    parser.on("text", this.onText.bind(this));

    this.parser = parser;
  }

  onStartElement(name, attrs) {
    const element = new Element(name, attrs);

    const { root, cursor } = this;

    if (!root) {
      this.root = element;
      this.emit("start", element);
    } else if (cursor !== root) {
      cursor.append(element);
    }

    this.cursor = element;
  }

  onEndElement(name) {
    const { root, cursor } = this;
    if (name !== cursor.name) {
      // <foo></bar>
      this.emit("error", new XMLError(`${cursor.name} must be closed.`));
      return;
    }

    if (cursor === root) {
      this.emit("end", root);
      return;
    }

    if (!cursor.parent) {
      cursor.parent = root;
      this.emit("element", cursor);
      this.cursor = root;
      return;
    }

    this.cursor = cursor.parent;
  }

  onText(str) {
    const { cursor } = this;
    if (!cursor) {
      this.emit("error", new XMLError(`${str} must be a child.`));
      return;
    }

    cursor.t(str);
  }

  write(data) {
    this.parser.write(data);
  }

  end(data) {
    if (data) {
      this.parser.write(data);
    }
  }
}

Parser.XMLError = XMLError;

module.exports = Parser;

},{"./XMLError":50,"events":53,"ltx/lib/Element":55,"ltx/lib/parsers/ltx":59}],50:[function(require,module,exports){
"use strict";

module.exports = class XMLError extends Error {
  constructor(...args) {
    super(...args);
    this.name = "XMLError";
  }
};

},{}],51:[function(require,module,exports){
"use strict";

const Parser = require("./Parser");

module.exports = function parse(data) {
  const p = new Parser();

  let result = null;
  let error = null;

  p.on("start", (el) => {
    result = el;
  });
  p.on("element", (el) => {
    result.append(el);
  });
  p.on("error", (err) => {
    error = err;
  });

  p.write(data);
  p.end();

  if (error) {
    throw error;
  } else {
    return result;
  }
};

},{"./Parser":49}],52:[function(require,module,exports){

},{}],53:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

var R = typeof Reflect === 'object' ? Reflect : null
var ReflectApply = R && typeof R.apply === 'function'
  ? R.apply
  : function ReflectApply(target, receiver, args) {
    return Function.prototype.apply.call(target, receiver, args);
  }

var ReflectOwnKeys
if (R && typeof R.ownKeys === 'function') {
  ReflectOwnKeys = R.ownKeys
} else if (Object.getOwnPropertySymbols) {
  ReflectOwnKeys = function ReflectOwnKeys(target) {
    return Object.getOwnPropertyNames(target)
      .concat(Object.getOwnPropertySymbols(target));
  };
} else {
  ReflectOwnKeys = function ReflectOwnKeys(target) {
    return Object.getOwnPropertyNames(target);
  };
}

function ProcessEmitWarning(warning) {
  if (console && console.warn) console.warn(warning);
}

var NumberIsNaN = Number.isNaN || function NumberIsNaN(value) {
  return value !== value;
}

function EventEmitter() {
  EventEmitter.init.call(this);
}
module.exports = EventEmitter;
module.exports.once = once;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._eventsCount = 0;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
var defaultMaxListeners = 10;

function checkListener(listener) {
  if (typeof listener !== 'function') {
    throw new TypeError('The "listener" argument must be of type Function. Received type ' + typeof listener);
  }
}

Object.defineProperty(EventEmitter, 'defaultMaxListeners', {
  enumerable: true,
  get: function() {
    return defaultMaxListeners;
  },
  set: function(arg) {
    if (typeof arg !== 'number' || arg < 0 || NumberIsNaN(arg)) {
      throw new RangeError('The value of "defaultMaxListeners" is out of range. It must be a non-negative number. Received ' + arg + '.');
    }
    defaultMaxListeners = arg;
  }
});

EventEmitter.init = function() {

  if (this._events === undefined ||
      this._events === Object.getPrototypeOf(this)._events) {
    this._events = Object.create(null);
    this._eventsCount = 0;
  }

  this._maxListeners = this._maxListeners || undefined;
};

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function setMaxListeners(n) {
  if (typeof n !== 'number' || n < 0 || NumberIsNaN(n)) {
    throw new RangeError('The value of "n" is out of range. It must be a non-negative number. Received ' + n + '.');
  }
  this._maxListeners = n;
  return this;
};

function _getMaxListeners(that) {
  if (that._maxListeners === undefined)
    return EventEmitter.defaultMaxListeners;
  return that._maxListeners;
}

EventEmitter.prototype.getMaxListeners = function getMaxListeners() {
  return _getMaxListeners(this);
};

EventEmitter.prototype.emit = function emit(type) {
  var args = [];
  for (var i = 1; i < arguments.length; i++) args.push(arguments[i]);
  var doError = (type === 'error');

  var events = this._events;
  if (events !== undefined)
    doError = (doError && events.error === undefined);
  else if (!doError)
    return false;

  // If there is no 'error' event listener then throw.
  if (doError) {
    var er;
    if (args.length > 0)
      er = args[0];
    if (er instanceof Error) {
      // Note: The comments on the `throw` lines are intentional, they show
      // up in Node's output if this results in an unhandled exception.
      throw er; // Unhandled 'error' event
    }
    // At least give some kind of context to the user
    var err = new Error('Unhandled error.' + (er ? ' (' + er.message + ')' : ''));
    err.context = er;
    throw err; // Unhandled 'error' event
  }

  var handler = events[type];

  if (handler === undefined)
    return false;

  if (typeof handler === 'function') {
    ReflectApply(handler, this, args);
  } else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      ReflectApply(listeners[i], this, args);
  }

  return true;
};

function _addListener(target, type, listener, prepend) {
  var m;
  var events;
  var existing;

  checkListener(listener);

  events = target._events;
  if (events === undefined) {
    events = target._events = Object.create(null);
    target._eventsCount = 0;
  } else {
    // To avoid recursion in the case that type === "newListener"! Before
    // adding it to the listeners, first emit "newListener".
    if (events.newListener !== undefined) {
      target.emit('newListener', type,
                  listener.listener ? listener.listener : listener);

      // Re-assign `events` because a newListener handler could have caused the
      // this._events to be assigned to a new object
      events = target._events;
    }
    existing = events[type];
  }

  if (existing === undefined) {
    // Optimize the case of one listener. Don't need the extra array object.
    existing = events[type] = listener;
    ++target._eventsCount;
  } else {
    if (typeof existing === 'function') {
      // Adding the second element, need to change to array.
      existing = events[type] =
        prepend ? [listener, existing] : [existing, listener];
      // If we've already got an array, just append.
    } else if (prepend) {
      existing.unshift(listener);
    } else {
      existing.push(listener);
    }

    // Check for listener leak
    m = _getMaxListeners(target);
    if (m > 0 && existing.length > m && !existing.warned) {
      existing.warned = true;
      // No error code for this since it is a Warning
      // eslint-disable-next-line no-restricted-syntax
      var w = new Error('Possible EventEmitter memory leak detected. ' +
                          existing.length + ' ' + String(type) + ' listeners ' +
                          'added. Use emitter.setMaxListeners() to ' +
                          'increase limit');
      w.name = 'MaxListenersExceededWarning';
      w.emitter = target;
      w.type = type;
      w.count = existing.length;
      ProcessEmitWarning(w);
    }
  }

  return target;
}

EventEmitter.prototype.addListener = function addListener(type, listener) {
  return _addListener(this, type, listener, false);
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.prependListener =
    function prependListener(type, listener) {
      return _addListener(this, type, listener, true);
    };

function onceWrapper() {
  if (!this.fired) {
    this.target.removeListener(this.type, this.wrapFn);
    this.fired = true;
    if (arguments.length === 0)
      return this.listener.call(this.target);
    return this.listener.apply(this.target, arguments);
  }
}

function _onceWrap(target, type, listener) {
  var state = { fired: false, wrapFn: undefined, target: target, type: type, listener: listener };
  var wrapped = onceWrapper.bind(state);
  wrapped.listener = listener;
  state.wrapFn = wrapped;
  return wrapped;
}

EventEmitter.prototype.once = function once(type, listener) {
  checkListener(listener);
  this.on(type, _onceWrap(this, type, listener));
  return this;
};

EventEmitter.prototype.prependOnceListener =
    function prependOnceListener(type, listener) {
      checkListener(listener);
      this.prependListener(type, _onceWrap(this, type, listener));
      return this;
    };

// Emits a 'removeListener' event if and only if the listener was removed.
EventEmitter.prototype.removeListener =
    function removeListener(type, listener) {
      var list, events, position, i, originalListener;

      checkListener(listener);

      events = this._events;
      if (events === undefined)
        return this;

      list = events[type];
      if (list === undefined)
        return this;

      if (list === listener || list.listener === listener) {
        if (--this._eventsCount === 0)
          this._events = Object.create(null);
        else {
          delete events[type];
          if (events.removeListener)
            this.emit('removeListener', type, list.listener || listener);
        }
      } else if (typeof list !== 'function') {
        position = -1;

        for (i = list.length - 1; i >= 0; i--) {
          if (list[i] === listener || list[i].listener === listener) {
            originalListener = list[i].listener;
            position = i;
            break;
          }
        }

        if (position < 0)
          return this;

        if (position === 0)
          list.shift();
        else {
          spliceOne(list, position);
        }

        if (list.length === 1)
          events[type] = list[0];

        if (events.removeListener !== undefined)
          this.emit('removeListener', type, originalListener || listener);
      }

      return this;
    };

EventEmitter.prototype.off = EventEmitter.prototype.removeListener;

EventEmitter.prototype.removeAllListeners =
    function removeAllListeners(type) {
      var listeners, events, i;

      events = this._events;
      if (events === undefined)
        return this;

      // not listening for removeListener, no need to emit
      if (events.removeListener === undefined) {
        if (arguments.length === 0) {
          this._events = Object.create(null);
          this._eventsCount = 0;
        } else if (events[type] !== undefined) {
          if (--this._eventsCount === 0)
            this._events = Object.create(null);
          else
            delete events[type];
        }
        return this;
      }

      // emit removeListener for all listeners on all events
      if (arguments.length === 0) {
        var keys = Object.keys(events);
        var key;
        for (i = 0; i < keys.length; ++i) {
          key = keys[i];
          if (key === 'removeListener') continue;
          this.removeAllListeners(key);
        }
        this.removeAllListeners('removeListener');
        this._events = Object.create(null);
        this._eventsCount = 0;
        return this;
      }

      listeners = events[type];

      if (typeof listeners === 'function') {
        this.removeListener(type, listeners);
      } else if (listeners !== undefined) {
        // LIFO order
        for (i = listeners.length - 1; i >= 0; i--) {
          this.removeListener(type, listeners[i]);
        }
      }

      return this;
    };

function _listeners(target, type, unwrap) {
  var events = target._events;

  if (events === undefined)
    return [];

  var evlistener = events[type];
  if (evlistener === undefined)
    return [];

  if (typeof evlistener === 'function')
    return unwrap ? [evlistener.listener || evlistener] : [evlistener];

  return unwrap ?
    unwrapListeners(evlistener) : arrayClone(evlistener, evlistener.length);
}

EventEmitter.prototype.listeners = function listeners(type) {
  return _listeners(this, type, true);
};

EventEmitter.prototype.rawListeners = function rawListeners(type) {
  return _listeners(this, type, false);
};

EventEmitter.listenerCount = function(emitter, type) {
  if (typeof emitter.listenerCount === 'function') {
    return emitter.listenerCount(type);
  } else {
    return listenerCount.call(emitter, type);
  }
};

EventEmitter.prototype.listenerCount = listenerCount;
function listenerCount(type) {
  var events = this._events;

  if (events !== undefined) {
    var evlistener = events[type];

    if (typeof evlistener === 'function') {
      return 1;
    } else if (evlistener !== undefined) {
      return evlistener.length;
    }
  }

  return 0;
}

EventEmitter.prototype.eventNames = function eventNames() {
  return this._eventsCount > 0 ? ReflectOwnKeys(this._events) : [];
};

function arrayClone(arr, n) {
  var copy = new Array(n);
  for (var i = 0; i < n; ++i)
    copy[i] = arr[i];
  return copy;
}

function spliceOne(list, index) {
  for (; index + 1 < list.length; index++)
    list[index] = list[index + 1];
  list.pop();
}

function unwrapListeners(arr) {
  var ret = new Array(arr.length);
  for (var i = 0; i < ret.length; ++i) {
    ret[i] = arr[i].listener || arr[i];
  }
  return ret;
}

function once(emitter, name) {
  return new Promise(function (resolve, reject) {
    function errorListener(err) {
      emitter.removeListener(name, resolver);
      reject(err);
    }

    function resolver() {
      if (typeof emitter.removeListener === 'function') {
        emitter.removeListener('error', errorListener);
      }
      resolve([].slice.call(arguments));
    };

    eventTargetAgnosticAddListener(emitter, name, resolver, { once: true });
    if (name !== 'error') {
      addErrorHandlerIfEventEmitter(emitter, errorListener, { once: true });
    }
  });
}

function addErrorHandlerIfEventEmitter(emitter, handler, flags) {
  if (typeof emitter.on === 'function') {
    eventTargetAgnosticAddListener(emitter, 'error', handler, flags);
  }
}

function eventTargetAgnosticAddListener(emitter, name, listener, flags) {
  if (typeof emitter.on === 'function') {
    if (flags.once) {
      emitter.once(name, listener);
    } else {
      emitter.on(name, listener);
    }
  } else if (typeof emitter.addEventListener === 'function') {
    // EventTarget does not have `error` event semantics like Node
    // EventEmitters, we do not listen for `error` events here.
    emitter.addEventListener(name, function wrapListener(arg) {
      // IE does not have builtin `{ once: true }` support so we
      // have to do it manually.
      if (flags.once) {
        emitter.removeEventListener(name, wrapListener);
      }
      listener(arg);
    });
  } else {
    throw new TypeError('The "emitter" argument must be of type EventEmitter. Received type ' + typeof emitter);
  }
}

},{}],54:[function(require,module,exports){
'use strict'

/**
 * Expose compositor.
 */

module.exports = compose

/**
 * Compose `middleware` returning
 * a fully valid middleware comprised
 * of all those which are passed.
 *
 * @param {Array} middleware
 * @return {Function}
 * @api public
 */

function compose (middleware) {
  if (!Array.isArray(middleware)) throw new TypeError('Middleware stack must be an array!')
  for (const fn of middleware) {
    if (typeof fn !== 'function') throw new TypeError('Middleware must be composed of functions!')
  }

  /**
   * @param {Object} context
   * @return {Promise}
   * @api public
   */

  return function (context, next) {
    // last called middleware #
    let index = -1
    return dispatch(0)
    function dispatch (i) {
      if (i <= index) return Promise.reject(new Error('next() called multiple times'))
      index = i
      let fn = middleware[i]
      if (i === middleware.length) fn = next
      if (!fn) return Promise.resolve()
      try {
        return Promise.resolve(fn(context, dispatch.bind(null, i + 1)));
      } catch (err) {
        return Promise.reject(err)
      }
    }
  }
}

},{}],55:[function(require,module,exports){
'use strict';

var _escape = require('./escape.js');

/**
 * Element
 *
 * Attributes are in the element.attrs object. Children is a list of
 * either other Elements or Strings for text content.
 **/
class Element {
  constructor(name, attrs) {
    this.name = name;
    this.parent = null;
    this.children = [];
    this.attrs = {};
    this.setAttrs(attrs);
  }

  /* Accessors */

  /**
   * if (element.is('message', 'jabber:client')) ...
   **/
  is(name, xmlns) {
    return this.getName() === name && (!xmlns || this.getNS() === xmlns);
  }

  /* without prefix */
  getName() {
    const idx = this.name.indexOf(":");
    return idx >= 0 ? this.name.slice(idx + 1) : this.name;
  }

  /**
   * retrieves the namespace of the current element, upwards recursively
   **/
  getNS() {
    const idx = this.name.indexOf(":");
    if (idx >= 0) {
      const prefix = this.name.slice(0, idx);
      return this.findNS(prefix);
    }
    return this.findNS();
  }

  /**
   * find the namespace to the given prefix, upwards recursively
   **/
  findNS(prefix) {
    if (!prefix) {
      /* default namespace */
      if (this.attrs.xmlns) {
        return this.attrs.xmlns;
      } else if (this.parent) {
        return this.parent.findNS();
      }
    } else {
      /* prefixed namespace */
      const attr = "xmlns:" + prefix;
      if (this.attrs[attr]) {
        return this.attrs[attr];
      } else if (this.parent) {
        return this.parent.findNS(prefix);
      }
    }
  }

  /**
   * Recursiverly gets all xmlns defined, in the form of {url:prefix}
   **/
  getXmlns() {
    let namespaces = {};

    if (this.parent) {
      namespaces = this.parent.getXmlns();
    }

    for (const attr in this.attrs) {
      const m = attr.match("xmlns:?(.*)");
      // eslint-disable-next-line  no-prototype-builtins
      if (this.attrs.hasOwnProperty(attr) && m) {
        namespaces[this.attrs[attr]] = m[1];
      }
    }
    return namespaces;
  }

  setAttrs(attrs) {
    if (typeof attrs === "string") {
      this.attrs.xmlns = attrs;
    } else if (attrs) {
      Object.assign(this.attrs, attrs);
    }
  }

  /**
   * xmlns can be null, returns the matching attribute.
   **/
  getAttr(name, xmlns) {
    if (!xmlns) {
      return this.attrs[name];
    }

    const namespaces = this.getXmlns();

    if (!namespaces[xmlns]) {
      return null;
    }

    return this.attrs[[namespaces[xmlns], name].join(":")];
  }

  /**
   * xmlns can be null
   **/
  getChild(name, xmlns) {
    return this.getChildren(name, xmlns)[0];
  }

  /**
   * xmlns can be null
   **/
  getChildren(name, xmlns) {
    const result = [];
    for (const child of this.children) {
      if (
        child.getName &&
        child.getName() === name &&
        (!xmlns || child.getNS() === xmlns)
      ) {
        result.push(child);
      }
    }
    return result;
  }

  /**
   * xmlns and recursive can be null
   **/
  getChildByAttr(attr, val, xmlns, recursive) {
    return this.getChildrenByAttr(attr, val, xmlns, recursive)[0];
  }

  /**
   * xmlns and recursive can be null
   **/
  getChildrenByAttr(attr, val, xmlns, recursive) {
    let result = [];
    for (const child of this.children) {
      if (
        child.attrs &&
        child.attrs[attr] === val &&
        (!xmlns || child.getNS() === xmlns)
      ) {
        result.push(child);
      }
      if (recursive && child.getChildrenByAttr) {
        result.push(child.getChildrenByAttr(attr, val, xmlns, true));
      }
    }
    if (recursive) {
      result = result.flat();
    }
    return result;
  }

  getChildrenByFilter(filter, recursive) {
    let result = [];
    for (const child of this.children) {
      if (filter(child)) {
        result.push(child);
      }
      if (recursive && child.getChildrenByFilter) {
        result.push(child.getChildrenByFilter(filter, true));
      }
    }
    if (recursive) {
      result = result.flat();
    }
    return result;
  }

  getText() {
    let text = "";
    for (const child of this.children) {
      if (typeof child === "string" || typeof child === "number") {
        text += child;
      }
    }
    return text;
  }

  getChildText(name, xmlns) {
    const child = this.getChild(name, xmlns);
    return child ? child.getText() : null;
  }

  /**
   * Return all direct descendents that are Elements.
   * This differs from `getChildren` in that it will exclude text nodes,
   * processing instructions, etc.
   */
  getChildElements() {
    return this.getChildrenByFilter((child) => {
      return child instanceof Element;
    });
  }

  /* Builder */

  /** returns uppermost parent */
  root() {
    if (this.parent) {
      return this.parent.root();
    }
    return this;
  }

  /** just parent or itself */
  up() {
    if (this.parent) {
      return this.parent;
    }
    return this;
  }

  /** create child node and return it */
  c(name, attrs) {
    return this.cnode(new Element(name, attrs));
  }

  cnode(child) {
    this.children.push(child);
    if (typeof child === "object") {
      child.parent = this;
    }
    return child;
  }

  append(...nodes) {
    for (const node of nodes) {
      this.children.push(node);
      if (typeof node === "object") {
        node.parent = this;
      }
    }
  }

  prepend(...nodes) {
    for (const node of nodes) {
      this.children.unshift(node);
      if (typeof node === "object") {
        node.parent = this;
      }
    }
  }

  /** add text node and return element */
  t(text) {
    this.children.push(text);
    return this;
  }

  /* Manipulation */

  /**
   * Either:
   *   el.remove(childEl)
   *   el.remove('author', 'urn:...')
   */
  remove(el, xmlns) {
    const filter =
      typeof el === "string"
        ? (child) => {
            /* 1st parameter is tag name */
            return !(child.is && child.is(el, xmlns));
          }
        : (child) => {
            /* 1st parameter is element */
            return child !== el;
          };

    this.children = this.children.filter(filter);

    return this;
  }

  text(val) {
    if (val && this.children.length === 1) {
      this.children[0] = val;
      return this;
    }
    return this.getText();
  }

  attr(attr, val) {
    if (typeof val !== "undefined" || val === null) {
      if (!this.attrs) {
        this.attrs = {};
      }
      this.attrs[attr] = val;
      return this;
    }
    return this.attrs[attr];
  }

  /* Serialization */

  toString() {
    let s = "";
    this.write((c) => {
      s += c;
    });
    return s;
  }

  _addChildren(writer) {
    writer(">");
    for (const child of this.children) {
      /* Skip null/undefined */
      if (child != null) {
        if (child.write) {
          child.write(writer);
        } else if (typeof child === "string") {
          writer(_escape.escapeXMLText(child));
        } else if (child.toString) {
          writer(_escape.escapeXMLText(child.toString(10)));
        }
      }
    }
    writer("</");
    writer(this.name);
    writer(">");
  }

  write(writer) {
    writer("<");
    writer(this.name);
    for (const k in this.attrs) {
      const v = this.attrs[k];
      // === null || undefined
      if (v != null) {
        writer(" ");
        writer(k);
        writer('="');
        writer(_escape.escapeXML(typeof v === "string" ? v : v.toString(10)));
        writer('"');
      }
    }
    if (this.children.length === 0) {
      writer("/>");
    } else {
      this._addChildren(writer);
    }
  }
}

Element.prototype.tree = Element.prototype.root;

module.exports = Element;

},{"./escape.js":58}],56:[function(require,module,exports){
'use strict';

function clone(el) {
  if (typeof el !== "object") return el;
  const copy = new el.constructor(el.name, el.attrs);
  for (let i = 0; i < el.children.length; i++) {
    const child = el.children[i];
    copy.cnode(clone(child));
  }
  return copy;
}

module.exports = clone;

},{}],57:[function(require,module,exports){
'use strict';

var Element = require('./Element.js');

function append(el, child) {
  if (Array.isArray(child)) {
    for (const c of child) append(el, c);
    return;
  }

  if (child === "" || child == null || child === true || child === false) {
    return;
  }

  el.cnode(child);
}

/**
 * JSX compatible API, use this function as pragma
 * https://facebook.github.io/jsx/
 *
 * @param  {string} name  name of the element
 * @param  {object} attrs object of attribute key/value pairs
 * @return {Element}      Element
 */
function createElement(name, attrs, ...children) {
  if (typeof attrs === "object" && attrs !== null) {
    // __self and __source are added by babel in development
    // https://github.com/facebook/react/pull/4596
    // https://babeljs.io/docs/en/babel-preset-react#development
    // https://babeljs.io/docs/en/babel-plugin-transform-react-jsx-source
    delete attrs.__source;
    delete attrs.__self;

    for (const [key, value] of Object.entries(attrs)) {
      if (value == null) delete attrs[key];
      else attrs[key] = value.toString(10);
    }
  }

  const el = new Element(name, attrs);

  for (const child of children) {
    append(el, child);
  }

  return el;
}

module.exports = createElement;

},{"./Element.js":55}],58:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

const escapeXMLTable = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

function escapeXMLReplace(match) {
  return escapeXMLTable[match];
}

const unescapeXMLTable = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

function unescapeXMLReplace(match) {
  if (match[1] === "#") {
    const num =
      match[2] === "x"
        ? parseInt(match.slice(3), 16)
        : parseInt(match.slice(2), 10);
    // https://www.w3.org/TR/xml/#NT-Char defines legal XML characters:
    // #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF]
    if (
      num === 0x9 ||
      num === 0xa ||
      num === 0xd ||
      (num >= 0x20 && num <= 0xd7ff) ||
      (num >= 0xe000 && num <= 0xfffd) ||
      (num >= 0x10000 && num <= 0x10ffff)
    ) {
      return String.fromCodePoint(num);
    }
    throw new Error("Illegal XML character 0x" + num.toString(16));
  }
  if (unescapeXMLTable[match]) {
    return unescapeXMLTable[match] || match;
  }
  throw new Error("Illegal XML entity " + match);
}

function escapeXML(s) {
  return s.replace(/["&'<>]/g, escapeXMLReplace);
}

function unescapeXML(s) {
  let result = "";
  let start = -1;
  let end = -1;
  let previous = 0;
  while (
    (start = s.indexOf("&", previous)) !== -1 &&
    (end = s.indexOf(";", start + 1)) !== -1
  ) {
    result =
      result +
      s.slice(previous, start) +
      unescapeXMLReplace(s.slice(start, end + 1));
    previous = end + 1;
  }

  // shortcut if loop never entered:
  // return the original string without creating new objects
  if (previous === 0) return s;

  // push the remaining characters
  result = result + s.substring(previous);

  return result;
}

function escapeXMLText(s) {
  return s.replace(/[&<>]/g, escapeXMLReplace);
}

function unescapeXMLText(s) {
  return s.replace(/&(amp|#38|lt|#60|gt|#62);/g, unescapeXMLReplace);
}

exports.escapeXML = escapeXML;
exports.escapeXMLText = escapeXMLText;
exports.unescapeXML = unescapeXML;
exports.unescapeXMLText = unescapeXMLText;

},{}],59:[function(require,module,exports){
'use strict';

var events = require('events');
var _escape = require('../escape.js');

const STATE_TEXT = 0;
const STATE_IGNORE_COMMENT = 1;
const STATE_IGNORE_INSTRUCTION = 2;
const STATE_TAG_NAME = 3;
const STATE_TAG = 4;
const STATE_ATTR_NAME = 5;
const STATE_ATTR_EQ = 6;
const STATE_ATTR_QUOT = 7;
const STATE_ATTR_VALUE = 8;
const STATE_CDATA = 9;
const STATE_IGNORE_CDATA = 10;

class SaxLtx extends events.EventEmitter {
  constructor() {
    super();
    let state = STATE_TEXT;
    let remainder;
    let parseRemainder;
    let tagName;
    let attrs;
    let endTag;
    let selfClosing;
    let attrQuote;
    let attrQuoteChar;
    let recordStart = 0;
    let attrName;

    this._handleTagOpening = function _handleTagOpening(
      endTag,
      tagName,
      attrs
    ) {
      if (!endTag) {
        this.emit("startElement", tagName, attrs);
        if (selfClosing) {
          this.emit("endElement", tagName);
        }
      } else {
        this.emit("endElement", tagName);
      }
    };

    this.write = function write(data) {
      if (typeof data !== "string") {
        data = data.toString();
      }
      let pos = 0;

      /* Anything from previous write()? */
      if (remainder) {
        data = remainder + data;
        pos += !parseRemainder ? remainder.length : 0;
        parseRemainder = false;
        remainder = null;
      }

      function endRecording() {
        if (typeof recordStart === "number") {
          const recorded = data.slice(recordStart, pos);
          recordStart = undefined;
          return recorded;
        }
      }

      for (; pos < data.length; pos++) {
        switch (state) {
          case STATE_TEXT: {
            // if we're looping through text, fast-forward using indexOf to
            // the next '<' character
            const lt = data.indexOf("<", pos);
            if (lt !== -1 && pos !== lt) {
              pos = lt;
            }

            break;
          }
          case STATE_ATTR_VALUE: {
            // if we're looping through an attribute, fast-forward using
            // indexOf to the next end quote character
            const quot = data.indexOf(attrQuoteChar, pos);
            if (quot !== -1) {
              pos = quot;
            }

            break;
          }
          case STATE_IGNORE_COMMENT: {
            // if we're looping through a comment, fast-forward using
            // indexOf to the first end-comment character
            const endcomment = data.indexOf("-->", pos);
            if (endcomment !== -1) {
              pos = endcomment + 2; // target the '>' character
            }

            break;
          }
          case STATE_IGNORE_CDATA: {
            // if we're looping through a CDATA, fast-forward using
            // indexOf to the first end-CDATA character ]]>
            const endCDATA = data.indexOf("]]>", pos);
            if (endCDATA !== -1) {
              pos = endCDATA + 2; // target the '>' character
            }

            break;
          }
          // No default
        }

        const c = data.charCodeAt(pos);
        switch (state) {
          case STATE_TEXT:
            if (c === 60 /* < */) {
              const text = endRecording();
              if (text) {
                this.emit("text", _escape.unescapeXML(text));
              }
              state = STATE_TAG_NAME;
              recordStart = pos + 1;
              attrs = {};
            }
            break;
          case STATE_CDATA:
            if (c === 93 /* ] */) {
              if (data.substr(pos + 1, 2) === "]>") {
                const cData = endRecording();
                if (cData) {
                  this.emit("text", cData);
                }
                state = STATE_TEXT;
              } else if (data.length < pos + 2) {
                parseRemainder = true;
                pos = data.length;
              }
            }
            break;
          case STATE_TAG_NAME:
            if (c === 47 /* / */ && recordStart === pos) {
              recordStart = pos + 1;
              endTag = true;
            } else if (c === 33 /* ! */) {
              if (data.substr(pos + 1, 7) === "[CDATA[") {
                recordStart = pos + 8;
                state = STATE_CDATA;
              } else if (
                data.length < pos + 8 &&
                "[CDATA[".startsWith(data.slice(pos + 1))
              ) {
                // We potentially have CDATA, but the chunk is ending; stop here and let the next write() decide
                parseRemainder = true;
                pos = data.length;
              } else {
                recordStart = undefined;
                state = STATE_IGNORE_COMMENT;
              }
            } else if (c === 63 /* ? */) {
              recordStart = undefined;
              state = STATE_IGNORE_INSTRUCTION;
            } else if (c <= 32 || c === 47 /* / */ || c === 62 /* > */) {
              tagName = endRecording();
              pos--;
              state = STATE_TAG;
            }
            break;
          case STATE_IGNORE_COMMENT:
            if (c === 62 /* > */) {
              const prevFirst = data.charCodeAt(pos - 1);
              const prevSecond = data.charCodeAt(pos - 2);
              if (
                (prevFirst === 45 /* - */ && prevSecond === 45) /* - */ ||
                (prevFirst === 93 /* ] */ && prevSecond === 93) /* ] */
              ) {
                state = STATE_TEXT;
              }
            }
            break;
          case STATE_IGNORE_INSTRUCTION:
            if (c === 62 /* > */) {
              const prev = data.charCodeAt(pos - 1);
              if (prev === 63 /* ? */) {
                state = STATE_TEXT;
              }
            }
            break;
          case STATE_TAG:
            if (c === 62 /* > */) {
              this._handleTagOpening(endTag, tagName, attrs);
              tagName = undefined;
              attrs = undefined;
              endTag = undefined;
              selfClosing = undefined;
              state = STATE_TEXT;
              recordStart = pos + 1;
            } else if (c === 47 /* / */) {
              selfClosing = true;
            } else if (c > 32) {
              recordStart = pos;
              state = STATE_ATTR_NAME;
            }
            break;
          case STATE_ATTR_NAME:
            if (c <= 32 || c === 61 /* = */) {
              attrName = endRecording();
              pos--;
              state = STATE_ATTR_EQ;
            }
            break;
          case STATE_ATTR_EQ:
            if (c === 61 /* = */) {
              state = STATE_ATTR_QUOT;
            }
            break;
          case STATE_ATTR_QUOT:
            if (c === 34 /* " */ || c === 39 /* ' */) {
              attrQuote = c;
              attrQuoteChar = c === 34 ? '"' : "'";
              state = STATE_ATTR_VALUE;
              recordStart = pos + 1;
            }
            break;
          case STATE_ATTR_VALUE:
            if (c === attrQuote) {
              const value = _escape.unescapeXML(endRecording());
              attrs[attrName] = value;
              attrName = undefined;
              state = STATE_TAG;
            }
            break;
        }
      }

      if (typeof recordStart === "number" && recordStart <= data.length) {
        remainder = data.slice(recordStart);
        recordStart = 0;
      }
    };
  }

  end(data) {
    if (data) {
      this.write(data);
    }

    /* Uh, yeah */
    this.write = function write() {};
  }
}

module.exports = SaxLtx;

},{"../escape.js":58,"events":53}],60:[function(require,module,exports){
'use strict';

var _escape = require('./escape.js');

function stringify(el, indent, level) {
  if (typeof indent === "number") indent = " ".repeat(indent);
  if (!level) level = 1;
  let s = `<${el.name}`;

  for (const k in el.attrs) {
    const v = el.attrs[k];
    // === null || undefined
    if (v != null) {
      s += ` ${k}="${_escape.escapeXML(typeof v === "string" ? v : v.toString(10))}"`;
    }
  }

  if (el.children.length > 0) {
    s += ">";
    for (const child of el.children) {
      if (child == null) continue;
      if (indent) s += "\n" + indent.repeat(level);
      s +=
        typeof child === "string"
          ? _escape.escapeXMLText(child)
          : stringify(child, indent, level + 1);
    }
    if (indent) s += "\n" + indent.repeat(level - 1);
    s += `</${el.name}>`;
  } else {
    s += "/>";
  }

  return s;
}

module.exports = stringify;

},{"./escape.js":58}],61:[function(require,module,exports){
// shim for using process in browser
var process = module.exports = {};

// cached from whatever global is present so that test runners that stub it
// don't break things.  But we need to wrap it in a try catch in case it is
// wrapped in strict mode code which doesn't define any globals.  It's inside a
// function because try/catches deoptimize in certain engines.

var cachedSetTimeout;
var cachedClearTimeout;

function defaultSetTimout() {
    throw new Error('setTimeout has not been defined');
}
function defaultClearTimeout () {
    throw new Error('clearTimeout has not been defined');
}
(function () {
    try {
        if (typeof setTimeout === 'function') {
            cachedSetTimeout = setTimeout;
        } else {
            cachedSetTimeout = defaultSetTimout;
        }
    } catch (e) {
        cachedSetTimeout = defaultSetTimout;
    }
    try {
        if (typeof clearTimeout === 'function') {
            cachedClearTimeout = clearTimeout;
        } else {
            cachedClearTimeout = defaultClearTimeout;
        }
    } catch (e) {
        cachedClearTimeout = defaultClearTimeout;
    }
} ())
function runTimeout(fun) {
    if (cachedSetTimeout === setTimeout) {
        //normal enviroments in sane situations
        return setTimeout(fun, 0);
    }
    // if setTimeout wasn't available but was latter defined
    if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
        cachedSetTimeout = setTimeout;
        return setTimeout(fun, 0);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedSetTimeout(fun, 0);
    } catch(e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't trust the global object when called normally
            return cachedSetTimeout.call(null, fun, 0);
        } catch(e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error
            return cachedSetTimeout.call(this, fun, 0);
        }
    }


}
function runClearTimeout(marker) {
    if (cachedClearTimeout === clearTimeout) {
        //normal enviroments in sane situations
        return clearTimeout(marker);
    }
    // if clearTimeout wasn't available but was latter defined
    if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
        cachedClearTimeout = clearTimeout;
        return clearTimeout(marker);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedClearTimeout(marker);
    } catch (e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't  trust the global object when called normally
            return cachedClearTimeout.call(null, marker);
        } catch (e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error.
            // Some versions of I.E. have different rules for clearTimeout vs setTimeout
            return cachedClearTimeout.call(this, marker);
        }
    }



}
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    if (!draining || !currentQueue) {
        return;
    }
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = runTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    runClearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        runTimeout(drainQueue);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;
process.prependListener = noop;
process.prependOnceListener = noop;

process.listeners = function (name) { return [] }

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],62:[function(require,module,exports){
(function(root, factory) {
  if (typeof exports === 'object') {
    // CommonJS
    factory(exports, module);
  } else if (typeof define === 'function' && define.amd) {
    // AMD
    define(['exports', 'module'], factory);
  }
}(this, function(exports, module) {

  /**
   * ANONYMOUS `Mechanism` constructor.
   *
   * This class implements the ANONYMOUS SASL mechanism.
   *
   * The ANONYMOUS SASL mechanism provides support for permitting anonymous
   * access to various services
   *
   * References:
   *  - [RFC 4505](http://tools.ietf.org/html/rfc4505)
   *
   * @api public
   */
  function Mechanism() {
  }
  
  Mechanism.prototype.name = 'ANONYMOUS';
  Mechanism.prototype.clientFirst = true;
  
  /**
   * Encode a response using optional trace information.
   *
   * Options:
   *  - `trace`  trace information (optional)
   *
   * @param {Object} cred
   * @api public
   */
  Mechanism.prototype.response = function(cred) {
    return cred.trace || '';
  };
  
  /**
   * Decode a challenge issued by the server.
   *
   * @param {String} chal
   * @api public
   */
  Mechanism.prototype.challenge = function(chal) {
  };

  exports = module.exports = Mechanism;
  
}));

},{}],63:[function(require,module,exports){
(function(root, factory) {
  if (typeof exports === 'object') {
    // CommonJS
    factory(exports,
            module,
            require('./lib/mechanism'));
  } else if (typeof define === 'function' && define.amd) {
    // AMD
    define(['exports',
            'module',
            './lib/mechanism'], factory);
  }
}(this, function(exports, module, Mechanism) {

  exports = module.exports = Mechanism;
  exports.Mechanism = Mechanism;
  
}));

},{"./lib/mechanism":62}],64:[function(require,module,exports){
(function(root, factory) {
  if (typeof exports === 'object') {
    // CommonJS
    factory(exports, module);
  } else if (typeof define === 'function' && define.amd) {
    // AMD
    define(['exports', 'module'], factory);
  }
}(this, function(exports, module) {

  /**
   * PLAIN `Mechanism` constructor.
   *
   * This class implements the PLAIN SASL mechanism.
   *
   * The PLAIN SASL mechanism provides support for exchanging a clear-text
   * username and password.  This mechanism should not be used without adequate
   * security provided by an underlying transport layer. 
   *
   * References:
   *  - [RFC 4616](http://tools.ietf.org/html/rfc4616)
   *
   * @api public
   */
  function Mechanism() {
  }
  
  Mechanism.prototype.name = 'PLAIN';
  Mechanism.prototype.clientFirst = true;
  
  /**
   * Encode a response using given credential.
   *
   * Options:
   *  - `username`
   *  - `password`
   *  - `authzid`   authorization identity (optional)
   *
   * @param {Object} cred
   * @api public
   */
  Mechanism.prototype.response = function(cred) {
    var str = '';
    str += cred.authzid || '';
    str += '\0';
    str += cred.username;
    str += '\0';
    str += cred.password;
    return str;
  };
  
  /**
   * Decode a challenge issued by the server.
   *
   * @param {String} chal
   * @return {Mechanism} for chaining
   * @api public
   */
  Mechanism.prototype.challenge = function(chal) {
    return this;
  };

  exports = module.exports = Mechanism;
  
}));

},{}],65:[function(require,module,exports){
arguments[4][63][0].apply(exports,arguments)
},{"./lib/mechanism":64,"dup":63}],66:[function(require,module,exports){
(function(root, factory) {
  if (typeof exports === 'object') {
    // CommonJS
    factory(exports, module);
  } else if (typeof define === 'function' && define.amd) {
    // AMD
    define(['exports', 'module'], factory);
  }
}(this, function(exports, module) {
  
  /**
   * `Factory` constructor.
   *
   * @api public
   */
  function Factory() {
    this._mechs = [];
  }
  
  /**
   * Utilize the given `mech` with optional `name`, overridding the mechanism's
   * default name.
   *
   * Examples:
   *
   *     factory.use(FooMechanism);
   *
   *     factory.use('XFOO', FooMechanism);
   *
   * @param {String|Mechanism} name
   * @param {Mechanism} mech
   * @return {Factory} for chaining
   * @api public
   */
  Factory.prototype.use = function(name, mech) {
    if (!mech) {
      mech = name;
      name = mech.prototype.name;
    }
    this._mechs.push({ name: name, mech: mech });
    return this;
  };
  
  /**
   * Create a new mechanism from supported list of `mechs`.
   *
   * If no mechanisms are supported, returns `null`.
   *
   * Examples:
   *
   *     var mech = factory.create(['FOO', 'BAR']);
   *
   * @param {Array} mechs
   * @return {Mechanism}
   * @api public
   */
  Factory.prototype.create = function(mechs) {
    for (var i = 0, len = this._mechs.length; i < len; i++) {
      for (var j = 0, jlen = mechs.length; j < jlen; j++) {
        var entry = this._mechs[i];
        if (entry.name == mechs[j]) {
          return new entry.mech();
        }
      }
    }
    return null;
  };

  exports = module.exports = Factory;
  
}));

},{}],67:[function(require,module,exports){
(function(root, factory) {
  if (typeof exports === 'object') {
    // CommonJS
    factory(exports,
            module,
            require('./lib/factory'));
  } else if (typeof define === 'function' && define.amd) {
    // AMD
    define(['exports',
            'module',
            './lib/factory'], factory);
  }
}(this, function(exports, module, Factory) {
  
  exports = module.exports = Factory;
  exports.Factory = Factory;
  
}));

},{"./lib/factory":66}]},{},[1]);
