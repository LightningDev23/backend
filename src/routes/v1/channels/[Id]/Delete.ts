import { HTTPErrors, Route } from '@kastelll/packages';
import User from '../../../../Middleware/User';

new Route('/', 'DELETE', [
    User({
        AccessType: 'LoggedIn',
        AllowedRequesters: 'All',
        Flags: []
    })
], async (req, res) => {
    const { Id } = req.params as { Id: string };

    const CanDelete = await req.mutils.Channel.hasPermission(Id, [
        'ManageChannels',
        'ManageChannel',
        'Administrator'
    ], true);

    if (!CanDelete) {
        const MissingPermissions = new HTTPErrors(4021);

        MissingPermissions.addError({
            Channel: {
                code: 'MissingPermissions',
                message: 'You are missing the permissions to manage channels in this guild.'
            },
        });

        res.status(403).json(MissingPermissions.toJSON());

        return;
    }

    const DeletedChannel = await req.mutils.Channel.deleteChannel(Id);

    if (!DeletedChannel) {
        const Errors = new HTTPErrors(4052);

        Errors.addError({
            ChannelId: {
                code: 'InvalidChannelId',
                message: 'The channel id is invalid.'
            },
        });

        res.status(400).json(Errors.toJSON());

        return;
    }

    res.status(200).json({
        Success: true,
        Message: 'Channel deleted successfully.'
    });
});