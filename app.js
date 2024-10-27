const express = require('express');
const QRCode = require('qrcode');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const pool = require('./db'); 
const { auth, requiresAuth } = require('express-openid-connect');
const dotenv = require('dotenv');
dotenv.config();

const app = express();

const config = {
    authRequired: false,
    auth0Logout: true,
    secret: process.env.SECRET,
    baseURL: process.env.BASE_URL,
    clientID: process.env.CLIENT_ID,
    issuerBaseURL: process.env.AUTH0_DOMAIN
};

app.use(auth(config));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT COUNT(*) FROM tickets');
        const ticketCount = result.rows[0].count;

        res.send(`
            <p>Broj generiranih ulaznica: ${ticketCount}</p>
        `);
    } catch (error) {
        console.error('Error fetching ticket count:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.post('/generate-ticket', async (req, res) => {
    const { vatin, firstName, lastName } = req.body;

    if (!vatin || !firstName || !lastName) {
        return res.status(400).send('Missing required fields');
    }

    try {
        const result = await pool.query('SELECT COUNT(*) FROM tickets WHERE vatin = $1', [vatin]);
        const ticketCount = parseInt(result.rows[0].count, 10);

        if (ticketCount >= 3) {
            return res.status(400).send('Maximum of 3 tickets per VATIN reached');
        }

        const ticketId = uuidv4();

        await pool.query(
            'INSERT INTO tickets (id, vatin, firstName, lastName) VALUES ($1, $2, $3, $4)',
            [ticketId, vatin, firstName, lastName]
        );

        const ticketUrl = `${process.env.BASE_URL}/ticket/${ticketId}`;
        QRCode.toDataURL(ticketUrl, (err, url) => {
            if (err) return res.status(500).send('Error generating QR code');

            res.send(`<img src="${url}">`);
        });
        
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/ticket/:id', requiresAuth(), async (req, res) => {
    const { id } = req.params;
    const user = req.oidc.user;

    try {
        const result = await pool.query('SELECT vatin, firstname, lastname, created_at FROM tickets WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).send('Ticket not found');
        }

        const ticket = result.rows[0];
        res.send(`
            <p>Ulogiran kao: ${user.name}</p>
            <p>OIB: ${ticket.vatin}</p>
            <p>Ime: ${ticket.firstname}</p>
            <p>Prezime: ${ticket.lastname}</p>
            <p>Datum kreiranja: ${ticket.created_at}</p>
        `); 
    } catch (error) {
        console.error('Error fetching ticket details: ', error);
        res.status(500).send('Internal Server Error');
    }
});

app.listen(process.env.PORT, () => {
    console.log(`Server running on port ${process.env.PORT}`);
});