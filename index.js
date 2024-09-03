const express = require('express')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
var cors = require('cors')
const app = express()
const port = process.env.PORT || 3000
const jwt = require('jsonwebtoken');
const SSLCommerzPayment = require('sslcommerz-lts')

app.use(express.json());
app.use(cors({
    origin: ['https://bus-ticket-pro.web.app', 'https://bus-ticket-pro.firebaseapp.com', 'http://localhost:5173']
}));

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
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            // console.log("headers.authorization nai")
            return res.status(401).send({ message: "Unauthorized User" });
        }
        const token = authHeader.split(" ")[1];
        if (!token) {
            // console.log("token nai")
            return res.status(401).send({ message: "Unauthorized User" });
        }

        const decodedEmail = jwt.verify(token, process.env.ACCESS_TOKEN);
        if (!decodedEmail) {
            // console.log("email er moddhe vejal ase ")
            return res.status(401).send({ message: "Unauthorized User" });
        }

        req.decodedEmail = decodedEmail;
        // console.log("req.decodedEmail", decodedEmail);
        next();
    } catch (error) {
        // Handle any errors that occur during token verification
        res.status(401).send({ message: "Unauthorized User", error: error.message });
    }
};

const verifyAdmin = (req, res, next) => {
    try {
        if (req?.decodedEmail.email !== process.env.ADMIN_EMAIL) {
            // console.log("email mile na")
            return res.status(401).send({ message: "Unauthorized User" });
        }
        next();
    } catch (error) {
        // Handle any errors that occur during token verification
        res.status(401).send({ message: "Unauthorized User", error: error.message });
    }
};

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();
        // Send a ping to confirm a successful connection
        const database = client.db("bus-ticket-pro");
        const busDetails = database.collection("bus-details");
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
            // console.log("seats ", seats)

            const data = {
                total_amount: money,
                currency: 'BDT',
                tran_id: tran_id, // use unique tran_id for each api call
                success_url: `https://bus-ticket-backend-nine.vercel.app/payment/success/${tran_id}`,
                fail_url: `https://bus-ticket-backend-nine.vercel.app/payment/fail/${tran_id}`,
                cancel_url: 'https://bus-ticket-backend-nine.vercel.app/cancel',
                ipn_url: 'https://bus-ticket-backend-nine.vercel.app/ipn',
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
                email, name, bus_name, seats, money, paidStatus: false, tran_id, pickPoint, dropPoint, journeyDate, createdAt: new Date()
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
                if (result.modifiedCount > 0) {
                    res.redirect(`https://bus-ticket-pro.web.app/paymentSuccess/${tran_id}`)
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
                    res.redirect(`https://bus-ticket-pro.web.app/paymentFail/${tran_id}`)
                }
            })
        })

        /// get all stops
        app.get("/allStops", async (req, res) => {
            try {
                const result = await routes_way.aggregate([
                    { $unwind: '$stops' },
                    { $group: { _id: '$stops', label: { $first: '$stops' }, value: { $first: '$stops' } } },
                    { $project: { _id: 1, label: 1, value: 1 } },
                    { $sort: { label: 1 } }  // Sorts the stops alphabetically by the 'label' field
                ]).toArray();

                res.send(result);
            } catch (error) {
                res.status(500).send({ error: 'An error occurred while fetching stops' });
            }
        });

        /// get single ticket info 
        app.get("/getTicket/:tran_id", verifyToken, async (req, res) => {
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
            // console.log("toicke", tickets)
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
                // console.log("routes", routes);

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

                // console.log("validRoute", validRoutes);
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
        app.get("/totalPayments", verifyToken, verifyAdmin, async (req, res) => {
            const email = req.headers.email; // or req.query.email or req.body.email
            if (email !== req?.decodedEmail.email || email !== process.env.ADMIN_EMAIL) {
                return res.status(401).send({ message: "Unauthorized User" });
            }
            const query = { paidStatus: true }
            const totalOrder = await order.find(query).toArray();
            const countTotalOrder = totalOrder.length
            const totalPayment = totalOrder.reduce((sum, payment) => sum + parseFloat(payment.money), 0);
            res.send({ totalPayment, countTotalOrder });
        })

        /// get Total bus count
        app.get("/totalBusCount", verifyToken, verifyAdmin, async (req, res) => {
            const email = req.headers.email; // or req.query.email or req.body.email
            if (email !== req?.decodedEmail.email || email !== process.env.ADMIN_EMAIL) {
                return res.status(401).send({ message: "Unauthorized User" });
            }
            const totalBusCount = await busDetails.countDocuments({});
            res.send({ totalBusCount });
        })

        /// get all bus info
        app.get("/allBusInfo", verifyToken, verifyAdmin, async (req, res) => {
            const email = req.headers.email; // or req.query.email or req.body.email
            if (email !== req?.decodedEmail.email || email !== process.env.ADMIN_EMAIL) {
                return res.status(401).send({ message: "Unauthorized User" });
            }
            const allBusInfo = await busDetails.find({}).sort({ bus_num: 1 }).toArray();
            res.send(allBusInfo);
        })

        /// get all ticket
        app.get("/allTicketInfo", verifyToken, verifyAdmin, async (req, res) => {
            const email = req.headers.email; // or req.query.email or req.body.email
            if (email !== req?.decodedEmail.email || email !== process.env.ADMIN_EMAIL) {
                return res.status(401).send({ message: "Unauthorized User" });
            }
            const filter = { paidStatus: true };
            const allTicket = await order.find(filter).sort({ journeyDate: -1 }).toArray();
            res.send(allTicket)
        })

        /// delete individual Bus
        app.delete("/busInfo/delete/:num", verifyToken, verifyAdmin, async (req, res) => {
            const email = req.headers.email; // or req.query.email or req.body.email
            if (email !== req?.decodedEmail.email || email !== process.env.ADMIN_EMAIL) {
                return res.status(401).send({ message: "Unauthorized User" });
            }
            const { num } = req.params;
            // console.log(num);
            const query = { bus_num: num }
            const result = await busDetails.deleteOne(query);
            res.send(result);
        })

        /// update bus details
        app.put("/busInfo/update/:num", verifyToken, verifyAdmin, async (req, res) => {
            const email = req.headers.email; // or req.query.email or req.body.email
            if (email !== req?.decodedEmail.email || email !== process.env.ADMIN_EMAIL) {
                return res.status(401).send({ message: "Unauthorized User" });
            }
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
        app.post("/addBus", verifyToken, verifyAdmin, async (req, res) => {
            const email = req.headers.email; // or req.query.email or req.body.email
            if (email !== req?.decodedEmail.email || email !== process.env.ADMIN_EMAIL) {
                return res.status(401).send({ message: "Unauthorized User" });
            }
            const { bus_num, seat_layout, departure_time, arrival_time, price, routeName, type, facilities, isGoing } = req.body.details
            const time24to12 = (time) => {
                let [hour, min] = time.split(":");
                const hourInt = parseInt(hour, 10);
                const modifier = hourInt >= 12 ? "PM" : "AM"
                hour = hourInt % 12 || 12
                hour = hour.toString().padStart(2, "0");  // Ensure hour has two digits
                // console.log(`${hour}:${min} ${modifier}`)
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
        app.get("/routes", verifyToken, verifyAdmin, async (req, res) => {
            const email = req.headers.email; // or req.query.email or req.body.email
            if (email !== req?.decodedEmail.email || email !== process.env.ADMIN_EMAIL) {
                return res.status(401).send({ message: "Unauthorized User" });
            }
            const result = await routes_way.find({}).toArray();
            res.send(result);
        })

        /// post new route
        app.post("/new_route", verifyToken, verifyAdmin, async (req, res) => {
            const email = req.headers.email; // or req.query.email or req.body.email
            if (email !== req?.decodedEmail.email || email !== process.env.ADMIN_EMAIL) {
                return res.status(401).send({ message: "Unauthorized User" });
            }
            const doc = req.body?.details;
            const result = await routes_way.insertOne(doc);
            res.send(result);
        })

        /// get user booked data
        app.get("/booked/:email", verifyToken, async (req, res) => {
            const { email } = req?.params;
            if (email !== req?.decodedEmail.email) {
                return res.status(401).send({ message: "Unauthorized User" });
            }
            const filter = { email: email, paidStatus: true }
            const result = await order.find(filter).toArray();
            res.send(result);
        })

        /// get bus info base on the AC and Non-AC
        app.get('/order/bus-count', verifyToken, verifyAdmin, async (req, res) => {
            try {
                const result = await order.aggregate([
                    {
                        $lookup: {
                            from: 'bus-details',  // Use the correct collection name here
                            localField: 'bus_name',
                            foreignField: 'bus_num',
                            as: 'busDetails'
                        }
                    },
                    { $unwind: '$busDetails' },  // Use the correct alias here
                    {
                        $group: {
                            _id: '$busDetails.type',
                            count: { $sum: 1 }
                        }
                    }
                ]).toArray();

                res.send(result);
            } catch (error) {
                res.status(500).send({ error: 'An error occurred while fetching bus count' });
            }
        });

        /// get latest 5 data
        app.get("/latestOrder", verifyToken, verifyAdmin, async (req, res) => {
            const email = req.headers.email; // or req.query.email or req.body.email
            if (email !== req?.decodedEmail.email || email !== process.env.ADMIN_EMAIL) {
                return res.status(401).send({ message: "Unauthorized User" });
            }
            const latestBookings = await order.find()
                .sort({ createdAt: -1 }) // Sort by createdAt in descending order
                .limit(5) // Limit to the top 5 results
                .toArray(); // Convert cursor to an array
            res.send(latestBookings);
        })


        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
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
    // console.log(`Example app listening on port ${port}`)
})