// ***********************************************************
// This example support/e2e.js is processed and
// loaded automatically before your test files.
//
// This is a great place to put global configuration and
// behavior that modifies Cypress.
//
// You can change the location of this file or turn off
// automatically serving support files with the
// 'supportFile' configuration option.
//
// You can read more here:
// https://on.cypress.io/configuration
// ***********************************************************

// Import commands.js using ES2015 syntax:
import './commands'

// Alternatively you can use CommonJS syntax:
// require('./commands')

// Hide fetch/XHR requests in command log for cleaner output
Cypress.on('window:before:load', (win) => {
	// Stub console.error to prevent cluttering test output
	cy.stub(win.console, 'error').as('consoleError')
})

// Add custom assertions for Obsidian plugin testing
Cypress.Commands.add('shouldNotHaveConsoleErrors', () => {
	cy.get('@consoleError').should('not.have.been.called')
})

// Custom command to wait for Obsidian to load
Cypress.Commands.add('waitForObsidianLoad', () => {
	cy.window().should('have.property', 'app')
	cy.window().its('app').should('exist')
})

// Custom command to check if plugin is loaded
Cypress.Commands.add('checkPluginLoaded', (pluginId) => {
	cy.window().then((win) => {
		expect(win.app.plugins.plugins[pluginId]).to.exist
		expect(win.app.plugins.enabledPlugins.has(pluginId)).to.be.true
	})
})
