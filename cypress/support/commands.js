// ***********************************************
// This example commands.js shows you how to
// create various custom commands and overwrite
// existing commands.
//
// For more comprehensive examples of custom
// commands please read more here:
// https://on.cypress.io/custom-commands
// ***********************************************

// Custom command to open Obsidian vault
Cypress.Commands.add('openVault', (vaultPath = 'test-vault') => {
	cy.visit('/')
	cy.contains('Open folder as vault').click()
	cy.get('input[type="file"]').selectFile(vaultPath, { force: true })
})

// Custom command to create a new note
Cypress.Commands.add('createNote', (noteName, content = '') => {
	cy.get('[data-tooltip="Create new note"]').click()
	cy.get('.view-content').find('.cm-editor').type(content)
	cy.get('.inline-title').type(noteName)
})

// Custom command to open canvas
Cypress.Commands.add('openCanvas', () => {
	cy.get('[data-tooltip="Create new canvas"]').click()
	cy.wait(1000) // Wait for canvas to load
})

// Custom command to add note to canvas
Cypress.Commands.add('addNoteToCanvas', (content) => {
	cy.get('.canvas-wrapper').rightclick()
	cy.contains('Add note').click()
	cy.get('.canvas-node-content .cm-editor').type(content)
})

// Custom command to trigger plugin command
Cypress.Commands.add('triggerCommand', (commandId) => {
	cy.get('body').type('{ctrl+shift+p}') // Open command palette
	cy.get('.prompt-input').type(commandId)
	cy.get('.suggestion-item').first().click()
})

// Custom command to set plugin settings
Cypress.Commands.add('setPluginSettings', (settings) => {
	cy.window().then((win) => {
		const plugin = win.app.plugins.plugins['chat-stream']
		if (plugin) {
			Object.assign(plugin.settings, settings)
			plugin.saveSettings()
		}
	})
})

// Custom command to mock API responses
Cypress.Commands.add('mockOpenAIResponse', (response) => {
	cy.intercept('POST', '**/chat/completions', {
		statusCode: 200,
		body: response
	}).as('openaiRequest')
})

// Custom command to verify canvas node exists
Cypress.Commands.add('verifyCanvasNode', (nodeText) => {
	cy.get('.canvas-node').contains(nodeText).should('be.visible')
})

// Custom command to verify settings tab
Cypress.Commands.add('openSettingsTab', (tabName) => {
	cy.get('[data-tooltip="Settings"]').click()
	cy.contains('Community plugins').click()
	cy.contains('Chat Stream').click()
})
