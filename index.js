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
        console.log("req.decodedEmail", decodedEmail);
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
        const routes_way = database.collection("routes");

        /// jwt
        app.post("/jwt", async (req, res) => {
            const { email } = req.body;
            const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN);
            res.send(token);
        })


        ///SSLCOMMERZE

        app.post('/order', verifyToken, async (req, res) => {

            const { email, bus_name, seats, money, name, pickPoint, dropPoint, journeyDate } = req.body;
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
                email, name, bus_name, seats, money, paidStatus: false, tran_id, pickPoint, dropPoint, journeyDate
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
                // const filter1 = { bus_num: bus_name }
                // let updateSeats = {};
                // seats.forEach(seat => {
                //     updateSeats[`seats.${seat}`] = false;
                // });
                // const result1 = await busDetails.updateOne(filter1, {
                //     $set: updateSeats
                // })

                // console.log("result", result1);
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

        /// get all stops
        app.get("/allStops", async (req, res) => {
            try {
                const result = await routes_way.aggregate([
                    { $unwind: '$stops' },
                    { $group: { _id: '$stops', label: { $first: '$stops' }, value: { $first: '$stops' } } },
                    { $project: { _id: 1, label: 1, value: 1 } }
                ]).toArray();

                res.send(result);
            } catch (error) {
                res.status(500).send({ error: 'An error occurred while fetching stops' });
            }
        });

        /// get single ticket info 
        app.get("/getTicket/:tran_id", async (req, res) => {
            const { tran_id } = req.params;
            const query = { tran_id: tran_id }
            const ticket = await order.findOne(query);
            res.send(ticket);
        })

        /// get booked seats
        app.get("/seatInfo/:bus_name/:journeyDate", async (req, res) => {
            const { bus_name, journeyDate } = req.params;
            const query = { bus_name: bus_name, journeyDate: journeyDate, paidStatus: true }
            const tickets = await order.find(query).toArray();
            console.log("toicke", tickets)
            res.send(tickets);
        })

        // Get available buses
        app.get("/validatePoints/:pickupPoint/:droppingPoint", async (req, res) => {
            const { pickupPoint, droppingPoint } = req.params;

            try {
                // Find routes that contain both the pickup and dropping points in the stops array
                const routes = await busDetails.find({
                    "route.stops": {
                        $all: [pickupPoint, droppingPoint]
                    }
                }).sort({ departure_time: 1 }).toArray();
                console.log("routes", routes);

                // Filter the routes based on the order of the stops and the direction of the bus
                const validRoutes = routes.filter(route => {
                    const pickupIndex = route.route.stops.indexOf(pickupPoint);
                    const droppingIndex = route.route.stops.indexOf(droppingPoint);

                    // Check if the pickup point comes before the dropping point and the bus is going in the right direction
                    if (pickupIndex < droppingIndex && route.isGoing) {
                        return true;
                    } else if (pickupIndex > droppingIndex && !route.isGoing) {
                        return true;
                    }
                    return false;
                });

                console.log("validRoute", validRoutes);
                if (validRoutes.length > 0) {
                    res.send(validRoutes);
                } else {
                    res.send("nothing");
                }
            } catch (error) {
                res.status(500).send("Server error");
            }
        });

        /// get info about a single bus
        app.get("/tickets/:bus_num", async (req, res) => {
            const { bus_num } = req.params;
            const query = { bus_num: bus_num }
            const busInfo = await busDetails.findOne(query);
            res.send(busInfo);
        })

        /// get total payment
        app.get("/totalPayments", async (req, res) => {
            const query = { paidStatus: true }
            const totalOrder = await order.find(query).toArray();
            const countTotalOrder = totalOrder.length
            const totalPayment = totalOrder.reduce((sum, payment) => sum + parseFloat(payment.money), 0);
            res.send({ totalPayment, countTotalOrder });
        })

        /// get Total bus count
        app.get("/totalBusCount", async (req, res) => {
            const totalBusCount = await busDetails.countDocuments({});
            res.send({ totalBusCount });
        })

        /// get total counter
        app.get("/totalCounter", async (req, res) => {
            const totalCounter = await areas.countDocuments({});
            res.send({ totalCounter });
        })

        /// get all bus info
        app.get("/allBusInfo", async (req, res) => {
            const allBusInfo = await busDetails.find({}).sort({ bus_num: 1 }).toArray();
            res.send(allBusInfo);
        })

        /// get all ticket
        app.get("/allTicketInfo", async (req, res) => {
            const filter = { paidStatus: true };
            const allTicket = await order.find(filter).sort({ journeyDate: -1 }).toArray();
            res.send(allTicket)
        })

        /// delete individual Bus
        app.delete("/busInfo/delete/:num", async (req, res) => {
            const { num } = req.params;
            // console.log(num);
            const query = { bus_num: num }
            const result = await busDetails.deleteOne(query);
            res.send(result);
        })

        /// update bus details
        app.put("/busInfo/update/:num", async (req, res) => {
            const { num } = req.params;
            // console.log(req.body);
            const { bus_num, seat_layout, departure_time, arrival_time, price, routeName } = req.body
            const query = { bus_num: num }
            const time24to12 = (time) => {
                let [hour, min] = time.split(":");
                const hourInt = parseInt(hour, 10);
                const modifier = hourInt >= 12 ? "PM" : "AM"
                hour = hourInt % 12 || 12
                hour = hour.toString().padStart(2, "0");  // Ensure hour has two digits

                return `${hour}:${min} ${modifier}`
            }
            const update_departure_time = time24to12(departure_time);
            const update_arrival_time = time24to12(arrival_time);
            // console.log(update_departure_time, update_arrival_time)
            const stops = await routes_way.findOne({ routeName: routeName });

            const details = {
                $set: {
                    seat_layout: seat_layout,
                    departure_time: update_departure_time,
                    arrival_time: update_arrival_time,
                    price: price,
                    "route.routeName": routeName,
                    "route.stops": stops.stops
                },
            }

            const result = await busDetails.updateOne(query, details)
            res.send(result);
        })

        // get all route
        app.get("/allRoutes", async (req, res) => {
            const allRouteInfo = await routes_way.find({}).toArray();
            res.send(allRouteInfo);
        })

        /// set a new bus
        app.post("/addBus", async (req, res) => {
            const { bus_num, seat_layout, departure_time, arrival_time, price, routeName, type, facilities, isGoing } = req.body.details
            const time24to12 = (time) => {
                let [hour, min] = time.split(":");
                const hourInt = parseInt(hour, 10);
                const modifier = hourInt >= 12 ? "PM" : "AM"
                hour = hourInt % 12 || 12
                hour = hour.toString().padStart(2, "0");  // Ensure hour has two digits
                console.log(`${hour}:${min} ${modifier}`)
                return `${hour}:${min} ${modifier}`
            }
            const update_departure_time = time24to12(departure_time);
            const update_arrival_time = time24to12(arrival_time);
            const stops = await routes_way.findOne({ routeName: routeName });
            const duration = arrival_time - departure_time

            const doc = {
                bus_num: bus_num,
                type: type,
                seat_layout: seat_layout,
                departure_time: update_departure_time,
                arrival_time: update_arrival_time,
                price: price,
                facilities: facilities,
                isGoing: isGoing,
                route: {
                    routeName: routeName,
                    stops: stops.stops
                }
            }
            const inserted = await busDetails.insertOne(doc);
            res.send(inserted);

        })

        /// get routes
        app.get("/routes", async (req, res) => {
            const result = await routes_way.find({}).toArray();
            res.send(result);
        })

        /// post new route
        app.post("/new_route", async (req, res) => {
            const doc = req.body?.details;
            const result = await routes_way.insertOne(doc);
            res.send(result);
        })

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