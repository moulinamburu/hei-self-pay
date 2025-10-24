# Getting Started with Create React App

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Iframe Payment Widget

This app exposes a lightweight iframe-friendly route at `/widget` that renders a payment widget suitable for embedding as a microfrontend.

### Embed in host

```html
<iframe id="payment-widget" src="https://your-domain.example/widget" style="width: 600px; height: 520px; border: 0;"></iframe>
<script>
  const iframe = document.getElementById('payment-widget');

  // Wait for the widget to say it's READY, then send INIT
  window.addEventListener('message', (event) => {
    if (!event.data || event.data.source !== 'payment-widget') return;
    if (event.data.type === 'READY') {
      iframe.contentWindow.postMessage({ source: 'host-app', type: 'INIT', payload: {
        amount: 2262,
        currency: 'AED',
        alias: 'Self pay balance',
        description: 'Encounter 100023'
      } }, '*');
    }

    if (event.data.type === 'RESULT') {
      console.log('Payment result', event.data.data);
      // success payload example:
      // { success: true, amount: 2262, currency: 'AED', alias: '...', description: '...', transactionId: '...' }
    }

    if (event.data.type === 'CANCELLED') {
      console.log('Payment cancelled', event.data.data);
    }

    if (event.data.type === 'ERROR') {
      console.error('Payment error', event.data.data);
    }
  });

  // Optional: cancel from the host
  // iframe.contentWindow.postMessage({ source: 'host-app', type: 'CANCEL' }, '*');
</script>
```

### URL init fallback

For static hosting or simple demos, you can pass init data via the `init` query parameter:

```
/widget?init=%7B%22amount%22%3A2262%2C%22currency%22%3A%22AED%22%2C%22alias%22%3A%22Self%20pay%22%2C%22description%22%3A%22Encounter%22%7D
```

### Events

- `READY` (widget -> host): widget is ready to receive `INIT`.
- `INIT` (host -> widget): optional payload `{ amount, currency, alias, description }`.
- `RESULT` (widget -> host): `{ success, amount, currency, alias, description, transactionId? }`.
- `CANCELLED` (either direction): cancellation notification.
- `ERROR` (widget -> host): unexpected error.


## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)
