To use OpenSSL to generate SSL/TLS certificates, follow these steps:

### Step-by-Step Plan

1. **Generate a Private Key**:
    - Use OpenSSL to generate a private key file (`key.pem`).

2. **Generate a Certificate Signing Request (CSR)**:
    - Use the private key to generate a CSR file (`csr.pem`).

3. **Generate a Self-Signed Certificate**:
    - Use the CSR to generate a self-signed certificate (`cert.pem`).

### Commands

1. **Generate a Private Key**:
    ```sh
    openssl genpkey -algorithm RSA -out key.pem -aes256
    ```

2. **Generate a Certificate Signing Request (CSR)**:
    ```sh
    openssl req -new -key key.pem -out csr.pem
    ```

3. **Generate a Self-Signed Certificate**:
    ```sh
    openssl req -x509 -key key.pem -in csr.pem -out cert.pem -days 365
    ```

### Example Usage in Code

Here’s how you can use the generated `key.pem` and `cert.pem` in your Node.js application:

```javascript
const fs = require('fs');
const https = require('https');
const express = require('express');

const app = express();

const options = {
    key: fs.readFileSync('./path/to/key.pem', 'utf-8'),
    cert: fs.readFileSync('./path/to/cert.pem', 'utf-8')
};

const httpsServer = https.createServer(options, app);

httpsServer.listen(5000, () => {
    console.log('HTTPS server is listening on port 5000');
});
```

### Explanation

- **Generate a Private Key**: The `openssl genpkey` command generates a private key using the RSA algorithm and saves it to `key.pem`.
- **Generate a CSR**: The `openssl req -new` command uses the private key to generate a CSR, which is saved to `csr.pem`.
- **Generate a Self-Signed Certificate**: The `openssl req -x509` command uses the CSR to generate a self-signed certificate, which is saved to `cert.pem`.

Ensure that the paths to your certificate and key files are correct and that the files are accessible by your application.

---

Summary
key.pem: Contains the private key used to decrypt data encrypted with the public key.
cert.pem: Contains the public certificate used to encrypt data and verify the server's identity.
csr.pem: Used to request a certificate from a CA, not needed after the certificate is issued.