// ***********************************************************
// This example support/component.js is processed and
// loaded automatically before your component test files.
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

// Example use:
// cy.mount(MyComponent)

// Component testing specific commands
Cypress.Commands.add('mountComponent', (component, props = {}) => {
	return cy.mount(component, { props })
})

// Mock Obsidian App for component testing
Cypress.Commands.add('mockObsidianApp', () => {
	cy.window().then((win) => {
		win.app = {
			plugins: {
				plugins: {
					'chat-stream': {
						settings: {
							provider: 'OpenAI',
							temperature: 0.7,
							systemPrompt: 'Test prompt'
						}
					}
				},
				enabledPlugins: new Set(['chat-stream'])
			},
			commands: {
				commands: {}
			},
			hotkeyManager: {
				customKeys: {}
			}
		}
	})
})
