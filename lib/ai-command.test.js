const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { chatModels } = require('./keyserver');

for (const command of ['ai', 'gpt', 'chatgpt']) {
    test(`${command} uses chatbot Gemini credentials and configured model with quoted context`, async () => {
        const source = fs.readFileSync(`${__dirname}/v1/commands.js`, 'utf8');
        const code = source.slice(source.indexOf("case 'gpt':"), source.indexOf("case 'lyrics':"));
        const sent = [];
        let request;
        const context = vm.createContext({ command, text: 'Explain this', pushname: 'Tester',
            m: { sender: 'person@s.whatsapp.net', chat: 'person@s.whatsapp.net', quoted: { text: 'A book with 200 pages' } },
            reply: () => assert.fail('Unexpected error'),
            EliteProTech: { sendMessage: async (jid, content) => { sent.push(content); return { key: { id: 'answer' } }; } },
            require: name => {
                assert.equal(name, './lib/keyserver');
                return { geminiKeys: async () => ['chatbot-only'], chatModels: () => chatModels({ GEMINI_CHAT_MODEL: 'chosen-chat-model' }),
                    requestGemini: async (body, options) => { request = { body, options }; return 'The book has 200 pages.'; } };
            }
        });
        await vm.runInContext(`(async()=>{ switch(command) { ${code} } })()`, context);
        assert.equal(request.options.keys[0], 'chatbot-only');
        assert.equal(request.options.models[0], 'chosen-chat-model');
        assert.match(request.body.contents[0].parts[0].text, /A book with 200 pages/);
        assert.equal(sent[1].text, 'The book has 200 pages.');
        assert.equal(sent[1].edit.id, 'answer');
    });
}