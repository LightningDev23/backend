/*! 
 *   ██╗  ██╗ █████╗ ███████╗████████╗███████╗██╗     
 *   ██║ ██╔╝██╔══██╗██╔════╝╚══██╔══╝██╔════╝██║     
 *  █████╔╝ ███████║███████╗   ██║   █████╗  ██║     
 *  ██╔═██╗ ██╔══██║╚════██║   ██║   ██╔══╝  ██║     
 * ██║  ██╗██║  ██║███████║   ██║   ███████╗███████╗
 * ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝   ╚═╝   ╚══════╝╚══════╝
 * Copyright(c) 2022-2023 DarkerInk
 * GPL 3.0 Licensed
 */

const userSchema = require("../../../../../utils/schemas/users/userSchema")
const { encrypt, decrypt } = require("../../../../../utils/classes/encryption")
const user = require("../../../../../utils/middleware/user")
const schemaData = require("../../../../../utils/schemaData")
const Route = require("../../../../../utils/classes/Route")

new Route(__dirname, "/fetch", "GET", [user({
    login: {
        loginRequired: true,
    }
})], async (req, res) => {
    /**
     * @type {String}
     */
    const userId = req?.params?.userId

    if (!userId) {
        res.status(400).send({
            code: 400,
            errors: [{
                code: "MISSING_USER_ID",
                message: "No User id provided"
                 }]
        })

        return;
    }

    const user = await userSchema.findById(encrypt(userId));

    if (!user) {
        res.status(404).send({
            code: 404,
            errors: [{
                code: "NO_USER_FOUND",
                message: "No user was found with the provided id"
                 }]
        })

        return;
    }

    res.send({
        code: 200,
        errors: [],
        responses: [],
        data: schemaData("user", user.toJSON())
    })

})