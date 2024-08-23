const express = require('express')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
var cors = require('cors')
const app = express()
const port = 3000
const jwt = require('jsonwebtoken');
const SSLCommerzPayment = require('sslcommerz-lts')


app.use(express.json());
app.use(cors())

const store_id = process.env.STORE_ID;
const store_passwd = process.env.STORE_PASS;
const is_live = false //true for live, false for sandbox


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.dr6rgwa.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

const verifyToken = (req, res, next) => {
    try {
        const token = req?.body?.token;
        if (!token) {
            return res.status(401).send({ message: "Unauthorized User" });
        }

        const decodedEmail = jwt.verify(token, process.env.ACCESS_TOKEN);
        if (!decodedEmail) {
            return res.status(401).send({ message: "Unauthorized User" });
        }

        req.decodedEmail = decodedEmail;
        next();
    } catch (error) {
        // Handle any errors that occur during token verification
        res.status(401).send({ message: "Unauthorized User", error: error.message });
    }
};


async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();
        // Send a ping to confirm a successful connection
        const database = client.db("bus-ticket-pro");
        const areas = database.collection("area");
        const busDetails = database.collection("bus-details");
        const user = database.collection("user");
        const order = database.collection("order");

        /// jwt
        app.post("/jwt", async (req, res) => {
            const { email } = req.body;
            const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN);
            res.send(token);
        })


        ///SSLCOMMERZE

        app.post('/order', verifyToken, async (req, res) => {

            const { email, bus_name, seats, money, name, pickPoint, dropPoint } = req.body;
            if (email !== req?.decodedEmail.email) {
                return res.status(401).send({ message: "Unauthorized User" });
            }
            const tran_id = new ObjectId().toString();
            console.log("seats ", seats)

            const data = {
                total_amount: money,
                currency: 'BDT',
                tran_id: tran_id, // use unique tran_id for each api call
                success_url: `http://localhost:3000/payment/success/${tran_id}`,
                fail_url: `http://localhost:3000/payment/fail/${tran_id}`,
                cancel_url: 'http://localhost:3030/cancel',
                ipn_url: 'http://localhost:3030/ipn',
                shipping_method: 'Courier',
                product_name: 'Ticket',
                product_category: 'Bus',
                product_profile: 'general',
                cus_name: name,
                cus_email: email,
                cus_add1: 'Dhaka',
                cus_add2: 'Dhaka',
                cus_city: 'Dhaka',
                cus_state: 'Dhaka',
                cus_postcode: '1000',
                cus_country: 'Bangladesh',
                cus_phone: '01711111111',
                cus_fax: '01711111111',
                ship_name: 'Customer Name',
                ship_add1: 'Dhaka',
                ship_add2: 'Dhaka',
                ship_city: 'Dhaka',
                ship_state: 'Dhaka',
                ship_postcode: 1000,
                ship_country: 'Bangladesh',
            };
            // console.log(data);

            const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live)
            sslcz.init(data).then(apiResponse => {
                // Redirect the user to payment gateway
                let GatewayPageURL = apiResponse.GatewayPageURL
                res.send({ url: GatewayPageURL })
                // console.log('Redirecting to: ', GatewayPageURL)
            });

            const finalOrder = {
                email, name, bus_name, seats, money, paidStatus: false, tran_id, pickPoint, dropPoint
            }
            const result = await order.insertOne(finalOrder);

            /// payment success url
            app.post("/payment/success/:tran_id", async (req, res) => {
                const tran_id = req.params.tran_id;
                // console.log(req.params.tran_id)
                const filter = { tran_id: tran_id }
                const updateDoc = {
                    $set: {
                        paidStatus: true
                    }
                }
                const result = await order.updateOne(filter, updateDoc)

                /// update seats of the bus
                const filter1 = { bus_num: bus_name }
                let updateSeats = {};
                seats.forEach(seat => {
                    updateSeats[`seats.${seat}`] = false;
                });
                const result1 = await busDetails.updateOne(filter1, {
                    $set: updateSeats
                })

                console.log("result", result1);
                // console.log("result", result)
                if (result.modifiedCount > 0) {
                    res.redirect(`http://localhost:5173/paymentSuccess/${tran_id}`)
                }
            })

            /// payment fail url
            app.post("/payment/fail/:tran_id", async (req, res) => {
                const tran_id = req.params.tran_id;
                // console.log(req.params.tran_id)
                const query = { tran_id: tran_id }
                const result = await order.deleteOne(query)
                // console.log("result", result)
                if (result.deletedCount > 0) {
                    res.redirect(`http://localhost:5173/paymentFail/${tran_id}`)
                }
            })

        })


        ///get area
        app.get('/area', async (req, res) => {
            const allPoints = await areas.find().toArray();
            res.send(allPoints);
        })

        app.get("/getTicket/:tran_id", async (req, res) => {
            const { tran_id } = req.params;
            const query = { tran_id: tran_id }
            const ticket = await order.findOne(query);
            res.send(ticket);
        })

        app.get("/validatePoints/:pickupPoint/:droppingPoint", async (req, res) => {
            const { pickupPoint, droppingPoint } = req.params;
            // console.l
            const routes = await busDetails.find({
                route_options: {
                    $all: [pickupPoint, droppingPoint]
                }
            }).sort({ departure_time: 1 }).toArray();
            if (routes.length > 0) {
                res.send(routes);
            } else {
                res.send("nothing");
            }
        })

        app.get("/tickets/:bus_num", async (req, res) => {
            const { bus_num } = req.params;
            const query = { bus_num: bus_num }
            const busInfo = await busDetails.findOne(query);
            res.send(busInfo);
        })

        /// user
        // app.post("/user", async (req, res) => {
        //     const data = req.body;
        //     const result = await user.insertOne(data);
        //     res.send(result);
        // })

        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('Hello World!')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})