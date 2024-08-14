const express = require('express')
const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config();
var cors = require('cors')
const app = express()
const port = 3000
const jwt = require('jsonwebtoken');

app.use(express.json());
app.use(cors())



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.dr6rgwa.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();
        // Send a ping to confirm a successful connection
        const database = client.db("bus-ticket-pro");
        const areas = database.collection("area");
        const busDetails = database.collection("bus-details");
        const user = database.collection("user");

        /// jwt
        app.post("/jwt", async (req, res) => {
            const { email } = req.body;
            const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN);
            res.send(token);
        })

        ///get area
        app.get('/area', async (req, res) => {
            const allPoints = await areas.find().toArray();
            res.send(allPoints);
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